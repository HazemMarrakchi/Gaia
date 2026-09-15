# Flink runtime + Prometheus metrics reporter, so the GAIA-Live dashboard can chart
# Flink job status next to the simulation metrics.
FROM flink:1.20-java17

ARG FLINK_VERSION=1.20.0

ADD https://repo1.maven.org/maven2/org/apache/flink/flink-metrics-prometheus/${FLINK_VERSION}/flink-metrics-prometheus-${FLINK_VERSION}.jar /opt/flink/lib/