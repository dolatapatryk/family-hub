plugins {
    kotlin("jvm")
    kotlin("plugin.serialization")
    application
}

val ktorVersion = "3.3.2"

dependencies {
    implementation(project(":core-domain"))
    implementation(project(":core-application"))
    implementation(project(":core-infrastructure-sqlite"))
    implementation("io.ktor:ktor-server-core:$ktorVersion")
    implementation("io.ktor:ktor-server-netty:$ktorVersion")
    implementation("io.ktor:ktor-server-content-negotiation:$ktorVersion")
    implementation("io.ktor:ktor-server-status-pages:$ktorVersion")
    implementation("io.ktor:ktor-serialization-kotlinx-json:$ktorVersion")
    // The composition root initializes the database and selects the adapters.
    implementation("org.jetbrains.exposed:exposed-core:0.61.0")
    implementation("ch.qos.logback:logback-classic:1.5.21")
    testImplementation("io.ktor:ktor-server-test-host:$ktorVersion")
    testImplementation("io.ktor:ktor-client-content-negotiation:$ktorVersion")
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.0")
    testImplementation("io.kotest:kotest-assertions-core:6.0.4")
    testImplementation("io.kotest:kotest-assertions-ktor:6.0.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.0")
}

kotlin { jvmToolchain(25) }
application {
    mainClass.set("familyhub.ApplicationKt")
    applicationName = "family-api"
}
tasks.test { useJUnitPlatform() }

tasks.named<JavaExec>("run") {
    workingDir(rootProject.projectDir)
}
