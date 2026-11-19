# Project conventions

## Java

- Prefer static imports for method names that remain clear without their type, such as `requireNonNull`. Keep calls such as `List.of()` qualified when the method name alone is vague.
- Create ids always using their static factory methods e.g. `householdId(value)`, `userId(value)` etc. (always static import)
- Represent optional model fields and optional parameters with `Optional<T>`. Do not use nullable fields or parameters to represent absence. For patch commands, represent “unchanged” separately from “set to empty”.
- Check required references for null in constructors, including compact constructors of records. Do not add null checks in ordinary methods; a null for a required argument is a programming bug. Optional values must use `Optional<T>`.
- Prefer fluent builders for constructing records and domain objects. Avoid static `create(...)` factories that accept every field.
- Keep domain ports such as repositories in the domain package. Keep use cases and application services in `application`, HTTP contracts in `api/rest`, and technology-specific implementations under `infrastructure/<technology>`.
- Prefer `var` whenever possible
- Use //given, //when, //then in tests
- when dealing with Optional use static methods from `Optionals` utils class. Use static method from original `Optional` when using `empty()`
