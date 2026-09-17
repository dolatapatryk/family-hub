plugins {
    kotlin("jvm")
    `java-test-fixtures`
}

dependencies {
    testImplementation("org.junit.jupiter:junit-jupiter:6.0.0")
    testImplementation("io.kotest:kotest-assertions-core:6.0.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:6.0.0")
}

kotlin { jvmToolchain(25) }
tasks.test { useJUnitPlatform() }
