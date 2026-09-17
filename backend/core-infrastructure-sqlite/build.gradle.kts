plugins { kotlin("jvm") }

dependencies {
    implementation(project(":core-domain"))
    implementation(project(":core-application"))
    implementation("org.jetbrains.exposed:exposed-core:0.61.0")
    implementation("org.jetbrains.exposed:exposed-jdbc:0.61.0")
    implementation("org.flywaydb:flyway-core:11.7.2")
    implementation("org.xerial:sqlite-jdbc:3.50.3.0")
    testImplementation(testFixtures(project(":core-domain")))
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.0")
    testImplementation("io.kotest:kotest-assertions-core:6.0.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.0")
}

kotlin { jvmToolchain(25) }
tasks.test { useJUnitPlatform() }
