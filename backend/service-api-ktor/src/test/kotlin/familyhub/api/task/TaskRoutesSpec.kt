package familyhub.api.task

import familyhub.support.TestUsers
import familyhub.support.seedOtherHousehold
import familyhub.support.setupTestApp
import familyhub.support.task
import familyhub.support.userClient
import io.kotest.assertions.ktor.client.shouldHaveStatus
import io.kotest.assertions.withClue
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.booleans.shouldBeTrue
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.nulls.shouldBeNull
import io.kotest.matchers.shouldBe
import io.ktor.client.call.body
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode.Companion.BadRequest
import io.ktor.http.HttpStatusCode.Companion.Conflict
import io.ktor.http.HttpStatusCode.Companion.Created
import io.ktor.http.HttpStatusCode.Companion.NotFound
import io.ktor.http.HttpStatusCode.Companion.OK
import io.ktor.http.HttpStatusCode.Companion.Unauthorized
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.util.UUID.randomUUID

class TaskRoutesSpec {

    @TempDir
    lateinit var directory: Path

    @Test
    fun `create edit assign complete and reopen a shared household task`() = testApplication {
        setupTestApp(directory)
        val author = userClient()
        val partner = userClient(TestUsers.partner)

        val response = author.post("/api/tasks") {
            setBody(CreateTaskRequest(title = "Call doctor", dueDate = "2026-09-17"))
        }
        val created = response.task(Created)
        val path = "/api/tasks/${created.id}"

        created.createdBy shouldBe TestUsers.author.toString()
        created.completed.shouldBeFalse()
        created.assignedTo.shouldBeNull()
        partner.get(path).task() shouldBe created

        val edited = partner.patch(path) { setBody("""{"title":"Dentist"}""") }.task()
        edited shouldBe created.copy(title = "Dentist")

        val assigned = author.post("$path/assign") {
            setBody(AssignTaskRequest(TestUsers.partner.toString()))
        }.task()
        assigned shouldBe edited.copy(assignedTo = TestUsers.partner.toString())

        val completed = partner.post("$path/complete").task()
        completed shouldBe assigned.copy(completed = true)
        author.post("$path/complete").task() shouldBe completed
        author.get("/api/tasks?completed=false").body<List<TaskResponse>>().shouldBeEmpty()
        author.get("/api/tasks?completed=true").body<List<TaskResponse>>() shouldBe listOf(completed)
        author.post("$path/reopen").task().completed.shouldBeFalse()

        val unassigned = partner.post("$path/unassign").task()
        unassigned.assignedTo.shouldBeNull()
        val cleared = author.patch(path) { setBody("""{"dueDate":null}""") }.task()
        cleared.dueDate.shouldBeNull()
        cleared.title shouldBe "Dentist"
        partner.get(path).task() shouldBe cleared
    }

    @Test
    fun `archived tasks cannot be mutated or physically deleted`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        val created = user.post("/api/tasks") { setBody(CreateTaskRequest("History")) }
            .task(Created)
        val path = "/api/tasks/${created.id}"
        val archived = user.post("$path/archive").task()

        user.patch(path) { setBody("""{"title":"Changed"}""") } shouldHaveStatus Conflict
        user.post("$path/assign") {
            setBody(AssignTaskRequest(TestUsers.partner.toString()))
        } shouldHaveStatus Conflict
        user.post("$path/unassign") shouldHaveStatus Conflict
        user.post("$path/complete") shouldHaveStatus Conflict
        user.post("$path/reopen") shouldHaveStatus Conflict
        user.get(path).task() shouldBe archived
    }

    @Test
    fun `filters combine with inclusive dates and household scope`() = testApplication {
        val outsider = seedOtherHousehold(directory)
        setupTestApp(directory)
        val user = userClient()
        val foreignUser = userClient(outsider.id)
        foreignUser.post("/api/tasks") { setBody(CreateTaskRequest("Foreign", "2026-09-17")) }
            .task(Created)
        for (date in listOf(null, "2026-09-16", "2026-09-18")) {
            user.post("/api/tasks") { setBody(CreateTaskRequest("Outside range", date)) }
                .task(Created)
        }
        val expected = user.post("/api/tasks") { setBody(CreateTaskRequest("Today", "2026-09-17")) }
            .task(Created)
        user.post("/api/tasks/${expected.id}/assign") {
            setBody(AssignTaskRequest(TestUsers.partner.toString()))
        }.task()
        val response =
            user.get("/api/tasks?completed=false&from=2026-09-17&to=2026-09-17&assignedTo=${TestUsers.partner}")

        response shouldHaveStatus OK
        response.body<List<TaskResponse>>() shouldBe listOf(expected.copy(assignedTo = TestUsers.partner.toString()))
        foreignUser.get("/api/tasks").body<List<TaskResponse>>().size shouldBe 1
    }

    @Test
    fun `a user cannot read or change another household's tasks`() = testApplication {
        val outsider = seedOtherHousehold(directory)
        setupTestApp(directory)
        val owner = userClient()
        val foreignUser = userClient(outsider.id)
        val created = owner.post("/api/tasks") { setBody(CreateTaskRequest("Private")) }
            .task(Created)
        val path = "/api/tasks/${created.id}"

        foreignUser.get(path) shouldHaveStatus NotFound
        foreignUser.patch(path) { setBody("""{"title":"Changed"}""") } shouldHaveStatus NotFound
        foreignUser.post("$path/assign") {
            setBody(AssignTaskRequest(outsider.id.toString()))
        } shouldHaveStatus NotFound
        for (action in listOf("unassign", "complete", "reopen", "archive")) {
            foreignUser.post("$path/$action") shouldHaveStatus NotFound
        }
        owner.get(path).task() shouldBe created
    }

    @Test
    fun `patch rejects assignment and completion and invalid input leaves stored data unchanged`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        val created = user.post("/api/tasks") { setBody(CreateTaskRequest("Valid")) }
            .task(Created)
        val path = "/api/tasks/${created.id}"
        val invalidPatches = listOf(
            """{"completed":true}""",
            """{"assignedTo":"${TestUsers.partner}"}""",
            """{"title":null}""",
            """{"title":" "}""",
            """{"dueDate":"2026-02-30"}""",
            "[]",
            "{",
        )
        for (body in invalidPatches) {
            val response = user.patch(path) { setBody(body) }
            withClue(body) { response shouldHaveStatus BadRequest }
            response.bodyAsText().contains("error").shouldBeTrue()
        }
        user.get(path).task() shouldBe created
    }

    @Test
    fun `assignment rejects missing unknown and foreign assignees`() = testApplication {
        val outsider = seedOtherHousehold(directory)
        setupTestApp(directory)
        val user = userClient()
        val created = user.post("/api/tasks") { setBody(CreateTaskRequest("Valid")) }
            .task(Created)
        val path = "/api/tasks/${created.id}"
        val invalidAssignments = listOf(
            "{}",
            """{"assignedTo":null}""",
            """{"assignedTo":"bad"}""",
            """{"assignedTo":"${randomUUID()}"}""",
            """{"assignedTo":"${outsider.id}"}""",
        )
        for (body in invalidAssignments) {
            user.post("$path/assign") { setBody(body) } shouldHaveStatus BadRequest
        }
        user.get(path).task() shouldBe created
    }

    @Test
    fun `identification is required for every task endpoint`() = testApplication {
        setupTestApp(directory)
        val path = "/api/tasks/${randomUUID()}"
        for (id in listOf(null, "bad", randomUUID().toString())) {
            val response = client.get("/api/tasks") { id?.let { header("X-User-Id", it) } }
            response shouldHaveStatus Unauthorized
        }
        client.get(path) shouldHaveStatus Unauthorized
        client.post("/api/tasks") {
            contentType(ContentType.Application.Json)
            setBody("""{"title":"Unauthenticated"}""")
        } shouldHaveStatus Unauthorized
        client.patch(path) shouldHaveStatus Unauthorized
        for (action in listOf("assign", "unassign", "complete", "reopen", "archive")) {
            client.post("$path/$action") shouldHaveStatus Unauthorized
        }
        client.get("/health") shouldHaveStatus OK
    }

    @Test
    fun `invalid queries payloads and task IDs return client errors`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        for (query in listOf(
            "completed=maybe",
            "archived=maybe",
            "from=2026-02-30",
            "assignedTo=bad",
            "from=2026-09-18&to=2026-09-17"
        )) {
            user.get("/api/tasks?$query") shouldHaveStatus BadRequest
        }
        for (body in listOf("{", "[]", "{}", """{"title":" "}""", """{"title":"Task","createdBy":"spoof"}""")) {
            user.post("/api/tasks") { setBody(body) } shouldHaveStatus BadRequest
        }
        user.get("/api/tasks/bad") shouldHaveStatus BadRequest
        val missing = "/api/tasks/${randomUUID()}"
        user.get(missing) shouldHaveStatus NotFound
        user.post("$missing/complete") shouldHaveStatus NotFound
    }
}
