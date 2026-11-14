package com.patrykdolata.familyhub;

import org.springframework.boot.SpringApplication;

public class TestFamilyHubApplication {

    public static void main(String[] args) {
        SpringApplication.from(FamilyHubApplication::main).with(TestcontainersConfiguration.class).run(args);
    }

}
