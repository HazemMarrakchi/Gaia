# Build
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /app
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY simulator-core simulator-core
COPY scenario-service scenario-service
RUN mvn -q -pl scenario-service -am package -DskipTests

# Runtime
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY --from=build /app/scenario-service/target/scenario-service-*.jar app.jar
EXPOSE 8282
ENTRYPOINT ["java", "-jar", "app.jar"]