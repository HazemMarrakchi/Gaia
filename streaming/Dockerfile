# Builds the Flink aggregator (with the PostgreSQL driver bundled) and submits it
# to the cluster started by docker-compose (see submit.sh).
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY engine ./engine
COPY streaming/pom.xml ./streaming/pom.xml
RUN mvn -q -B -f streaming/pom.xml -DskipTests dependency:go-offline || true
COPY streaming/src ./streaming/src
RUN mvn -q -B -f streaming/pom.xml -DskipTests package

FROM flink:1.20-java17
COPY --from=build /src/streaming/target/gaia-streaming-0.1.0-SNAPSHOT-jar-with-dependencies.jar /opt/flink/usrlib/gaia-streaming.jar
COPY streaming/submit.sh /opt/gaia/submit.sh
RUN chmod +x /opt/gaia/submit.sh
ENTRYPOINT ["/opt/gaia/submit.sh"]