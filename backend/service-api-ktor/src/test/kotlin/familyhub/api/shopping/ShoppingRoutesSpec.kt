package familyhub.api.shopping

import familyhub.support.TestUsers
import familyhub.support.seedOtherHousehold
import familyhub.support.setupTestApp
import familyhub.support.userClient
import io.kotest.assertions.ktor.client.shouldHaveStatus
import io.kotest.assertions.withClue
import io.kotest.matchers.booleans.shouldBeFalse
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.ktor.client.call.body
import io.ktor.client.request.delete
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.HttpStatusCode.Companion.BadRequest
import io.ktor.http.HttpStatusCode.Companion.Created
import io.ktor.http.HttpStatusCode.Companion.NoContent
import io.ktor.http.HttpStatusCode.Companion.NotFound
import io.ktor.http.HttpStatusCode.Companion.OK
import io.ktor.http.HttpStatusCode.Companion.Unauthorized
import io.ktor.http.contentType
import io.ktor.server.testing.testApplication
import org.junit.jupiter.api.Test
import org.junit.jupiter.api.io.TempDir
import java.nio.file.Path
import java.time.Instant
import java.util.UUID.randomUUID

class ShoppingRoutesSpec {
    @TempDir
    lateinit var directory: Path

    @Test
    fun `household members can add edit purchase reopen and delete an item`() = testApplication {
        setupTestApp(directory)
        val author = userClient()
        val partner = userClient(TestUsers.partner)
        val created = author.post("/api/shopping-items") {
            setBody(CreateShoppingItemRequest(" Milk ", "2"))
        }.shoppingItem(Created)
        val path = "/api/shopping-items/${created.id}"

        created.name shouldBe "Milk"
        created.quantity shouldBe "2"
        created.addedBy shouldBe TestUsers.author.toString()
        created.completed.shouldBeFalse()
        Instant.parse(created.createdAt).toString() shouldBe created.createdAt
        partner.get("/api/shopping-items").body<List<ShoppingItemResponse>>() shouldBe listOf(created)

        val edited = partner.patch(path) { setBody("""{"name":"Bread","quantity":"3"}""") }.shoppingItem()
        edited shouldBe created.copy(name = "Bread", quantity = "3")
        val purchased = partner.patch(path) { setBody("""{"completed":true}""") }.shoppingItem()
        purchased shouldBe edited.copy(completed = true)
        author.patch(path) { setBody("""{"completed":true}""") }.shoppingItem() shouldBe purchased
        author.get("/api/shopping-items").body<List<ShoppingItemResponse>>().shouldBeEmpty()
        author.get("/api/shopping-items?completed=false").body<List<ShoppingItemResponse>>().shouldBeEmpty()
        author.get("/api/shopping-items?completed=true").body<List<ShoppingItemResponse>>() shouldBe listOf(purchased)

        val reopened = author.patch(path) { setBody("""{"completed":false,"quantity":null}""") }.shoppingItem()
        reopened shouldBe edited.copy(quantity = null)
        author.patch(path) { setBody("{}") }.shoppingItem() shouldBe reopened
        partner.get("/api/shopping-items").body<List<ShoppingItemResponse>>() shouldBe listOf(reopened)

        val deleted = partner.delete(path)
        deleted shouldHaveStatus NoContent
        deleted.bodyAsText() shouldBe ""
        author.get("/api/shopping-items").body<List<ShoppingItemResponse>>().shouldBeEmpty()
        author.delete(path) shouldHaveStatus NotFound
    }

    @Test
    fun `quantity is optional and purchased items can be deleted`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        val created = user.post("/api/shopping-items") { setBody("""{"name":"Bananas"}""") }.shoppingItem(Created)
        created.quantity shouldBe null
        val path = "/api/shopping-items/${created.id}"
        user.patch(path) { setBody("""{"completed":true}""") }.shoppingItem()
        user.delete(path) shouldHaveStatus NoContent
        user.get("/api/shopping-items?completed=true").body<List<ShoppingItemResponse>>().shouldBeEmpty()
    }

    @Test
    fun `households cannot list change or delete each other's items`() = testApplication {
        val outsider = seedOtherHousehold(directory)
        setupTestApp(directory)
        val owner = userClient()
        val foreignUser = userClient(outsider.id)
        val created = owner.post("/api/shopping-items") { setBody(CreateShoppingItemRequest("Private")) }
            .shoppingItem(Created)
        val path = "/api/shopping-items/${created.id}"
        val foreign = foreignUser.post("/api/shopping-items") { setBody(CreateShoppingItemRequest("Foreign")) }
            .shoppingItem(Created)

        foreignUser.get("/api/shopping-items").body<List<ShoppingItemResponse>>() shouldBe listOf(foreign)
        foreignUser.patch(path) { setBody("""{"completed":true}""") } shouldHaveStatus NotFound
        foreignUser.delete(path) shouldHaveStatus NotFound
        owner.get("/api/shopping-items").body<List<ShoppingItemResponse>>() shouldBe listOf(created)
        owner.patch(path) { setBody("""{"completed":true}""") }.shoppingItem()
        foreignUser.get("/api/shopping-items?completed=true").body<List<ShoppingItemResponse>>().shouldBeEmpty()
    }

    @Test
    fun `invalid patches leave the stored item unchanged`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        val created = user.post("/api/shopping-items") { setBody(CreateShoppingItemRequest("Valid", "2")) }
            .shoppingItem(Created)
        val invalidPatches = listOf(
            """{"name":null}""",
            """{"name":" ","completed":true}""",
            """{"completed":null}""",
            """{"completed":"maybe"}""",
            """{"quantity":{}}""",
            """{"addedBy":"${TestUsers.partner}"}""",
            """{"householdId":"${randomUUID()}"}""",
            "[]",
            "{",
        )
        for (body in invalidPatches) {
            withClue(body) {
                user.patch("/api/shopping-items/${created.id}") { setBody(body) } shouldHaveStatus BadRequest
            }
        }
        user.get("/api/shopping-items").body<List<ShoppingItemResponse>>() shouldBe listOf(created)
    }

    @Test
    fun `invalid creation filters and IDs return client errors`() = testApplication {
        setupTestApp(directory)
        val user = userClient()
        for (body in listOf("{", "[]", "{}", """{"name":null}""", """{"name":" "}""",
            """{"name":"Milk","addedBy":"spoof"}""", """{"name":"Milk","completed":true}""")) {
            withClue(body) { user.post("/api/shopping-items") { setBody(body) } shouldHaveStatus BadRequest }
        }
        for (value in listOf("maybe", "", "1")) {
            user.get("/api/shopping-items?completed=$value") shouldHaveStatus BadRequest
        }
        user.patch("/api/shopping-items/bad") { setBody("{}") } shouldHaveStatus BadRequest
        user.delete("/api/shopping-items/bad") shouldHaveStatus BadRequest
        val missing = "/api/shopping-items/${randomUUID()}"
        user.patch(missing) { setBody("{}") } shouldHaveStatus NotFound
        user.delete(missing) shouldHaveStatus NotFound
        user.get("/api/shopping-items").body<List<ShoppingItemResponse>>().shouldBeEmpty()
    }

    @Test
    fun `identification is required for every shopping endpoint`() = testApplication {
        setupTestApp(directory)
        val path = "/api/shopping-items/${randomUUID()}"
        for (id in listOf(null, "bad", randomUUID().toString())) {
            client.get("/api/shopping-items") { id?.let { header("X-User-Id", it) } } shouldHaveStatus Unauthorized
            client.post("/api/shopping-items") {
                id?.let { header("X-User-Id", it) }
                contentType(ContentType.Application.Json)
                setBody("""{"name":"Milk"}""")
            } shouldHaveStatus Unauthorized
            client.patch(path) {
                id?.let { header("X-User-Id", it) }
                contentType(ContentType.Application.Json)
                setBody("{}")
            } shouldHaveStatus Unauthorized
            client.delete(path) { id?.let { header("X-User-Id", it) } } shouldHaveStatus Unauthorized
        }
    }
}

private suspend fun HttpResponse.shoppingItem(expectedStatus: HttpStatusCode = OK): ShoppingItemResponse {
    this shouldHaveStatus expectedStatus
    return body()
}
