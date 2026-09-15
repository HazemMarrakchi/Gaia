# Build
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY simulator-core simulator-core
COPY ingestion-service ingestion-service
RUN mvn -q -pl ingestion-service -am package -DskipTests

# Runtime
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/ingestion-service/target/ingestion-service-*.jar app.jar
EXPOSE 8181
ENTRYPOINT ["java", "-jar", "app.jar"]