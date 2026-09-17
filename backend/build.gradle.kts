plugins {
    kotlin("jvm") version "2.3.21" apply false
    kotlin("plugin.serialization") version "2.3.21" apply false
    base
}

allprojects {
    repositories { mavenCentral() }
}

tasks.register("run") { dependsOn(":service-api-ktor:run") }
tasks.register("installDist") { dependsOn(":service-api-ktor:installDist") }
tasks.register("test") { dependsOn(subprojects.map { "${it.path}:test" }) }
tasks.named("check") { dependsOn(subprojects.map { "${it.path}:check" }) }
tasks.named("assemble") { dependsOn(subprojects.map { "${it.path}:assemble" }) }
tasks.named("clean") { dependsOn(subprojects.map { "${it.path}:clean" }) }
