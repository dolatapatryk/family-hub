# Backend

The backend is a Gradle multi-project modular monolith. `app` is the Spring
Boot composition root, `common` holds shared identity types and transaction
boundaries, and each business domain lives under `modules/`.

Each domain keeps its own hexagonal layers. Domain ports live in `domain`,
use cases and application services live in `application`, HTTP contracts live
in `api`, and technology-specific implementations live in `infrastructure`.
Domain modules should depend on `common`; cross-domain calls should use the
other module's public application contract.

The first module is `modules/shopping-list`. Its domain and application layer
are started; REST and jOOQ integration packages are reserved for the next
implementation step.
