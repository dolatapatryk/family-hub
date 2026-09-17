FROM eclipse-temurin:25-jdk-alpine AS build
WORKDIR /app
COPY . .
RUN chmod +x gradlew && ./gradlew --no-daemon installDist

FROM eclipse-temurin:25-jre-alpine
RUN addgroup -S family && adduser -S family -G family
WORKDIR /app
COPY --from=build /app/build/install/family-api/ ./
RUN mkdir -p /app/data && chown family:family /app/data
USER family
EXPOSE 8080
ENTRYPOINT ["/app/bin/family-api"]
