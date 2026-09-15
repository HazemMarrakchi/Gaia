package com.gaia.streaming;

import com.gaia.streaming.AggregatorJob.SimEvent;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.time.Instant;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * The streaming job parses Kafka records by hand (no Jackson on the cluster),
 * so the payload shape produced by the ingestion service is contract-tested
 * here — including the spaced JSON variant that used to leak a leading space
 * into window keys ({@code " cities"} instead of {@code "cities"}).
 */
class SimEventParsingTest {

    /** Exactly what engine/ingestion-service publishes today. */
    private static final String COMPACT =
            "{\"id\":\"8756b942-6424-4778-a347-4d0c1799f17a\",\"tick\":9250,"
                    + "\"ts\":\"2026-09-15T00:07:42.500Z\",\"domain\":\"energy\","
                    + "\"type\":\"GRID_STRESS\",\"region\":\"global\",\"severity\":0.988,"
                    + "\"payload\":{\"plant\":\"wind-3\"}}";

    /** Same data, written by a producer that pretty-prints with spaces. */
    private static final String SPACED =
            "{ \"id\": \"abc\", \"tick\": 9250, \"ts\": \"2026-09-15T00:07:42.500Z\", "
                    + "\"domain\": \"cities\", \"type\": \"CITY_STRAIN\", "
                    + "\"region\": \"eu-west\", \"severity\": 0.5, \"payload\": {} }";

    @Test
    @DisplayName("parses the compact ingestion-service payload")
    void parsesCompactPayload() {
        SimEvent event = SimEvent.fromJson(COMPACT);

        assertThat(event).isNotNull();
        assertThat(event.id()).isEqualTo("8756b942-6424-4778-a347-4d0c1799f17a");
        assertThat(event.tick()).isEqualTo(9250);
        assertThat(event.domain()).isEqualTo("energy");
        assertThat(event.type()).isEqualTo("GRID_STRESS");
        assertThat(event.region()).isEqualTo("global");
        assertThat(event.severity()).isEqualTo(0.988);
    }

    @Test
    @DisplayName("parses spaced JSON without polluting the window key")
    void parsesSpacedPayloadWithoutPadding() {
        SimEvent event = SimEvent.fromJson(SPACED);

        assertThat(event).isNotNull();
        assertThat(event.domain()).isEqualTo("cities");
        assertThat(event.region()).isEqualTo("eu-west");
        assertThat(event.type()).isEqualTo("CITY_STRAIN");
        assertThat(event.severity()).isEqualTo(0.5);
    }

    @Test
    @DisplayName("both payload styles yield the same aggregate key")
    void bothPayloadStylesAgreeOnDomain() {
        String compactKey = SimEvent.fromJson(COMPACT).domain();
        String spacedKey = SimEvent.fromJson(
                COMPACT.replace("\"domain\":\"energy\"", "\"domain\": \"energy\"")).domain();

        assertThat(spacedKey).isEqualTo(compactKey);
    }

    @Test
    @DisplayName("numeric fields tolerate spacing and quoting")
    void numericFieldsTolerateSpacingAndQuoting() {
        SimEvent event = SimEvent.fromJson(
                "{\"domain\":\"finance\",\"tick\": \"12\",\"severity\":  0.25 }");

        assertThat(event).isNotNull();
        assertThat(event.tick()).isEqualTo(12);
        assertThat(event.severity()).isEqualTo(0.25);
    }

    @Test
    @DisplayName("region falls back to the world scope when absent")
    void regionFallsBackToGlobal() {
        SimEvent event = SimEvent.fromJson("{\"domain\":\"transport\",\"tick\":1,\"severity\":0.1}");

        assertThat(event).isNotNull();
        assertThat(event.region()).isEqualTo("global");
    }

    @Test
    @DisplayName("window time comes from the payload ts, not from the tick counter")
    void eventTimeComesFromPayloadTimestamp() {
        SimEvent event = SimEvent.fromJson(COMPACT);

        assertThat(event).isNotNull();
        assertThat(event.ts()).isEqualTo(Instant.parse("2026-09-15T00:07:42.500Z"));
        assertThat(event.eventTimeMillis())
                .isEqualTo(Instant.parse("2026-09-15T00:07:42.500Z").toEpochMilli())
                .isNotEqualTo(event.tick() * 1000L);
    }

    @Test
    @DisplayName("window time falls back to tick seconds when ts is missing or malformed")
    void eventTimeFallsBackToTickSeconds() {
        SimEvent noTimestamp = SimEvent.fromJson("{\"domain\":\"energy\",\"tick\":42,\"severity\":0.1}");
        assertThat(noTimestamp).isNotNull();
        assertThat(noTimestamp.ts()).isNull();
        assertThat(noTimestamp.eventTimeMillis()).isEqualTo(42_000L);

        SimEvent badTimestamp = SimEvent.fromJson(
                "{\"domain\":\"energy\",\"tick\":42,\"ts\":\"yesterday\",\"severity\":0.1}");
        assertThat(badTimestamp).isNotNull();
        assertThat(badTimestamp.ts()).isNull();
        assertThat(badTimestamp.eventTimeMillis()).isEqualTo(42_000L);
    }

    @Test
    @DisplayName("malformed records are dropped instead of failing the job")
    void malformedRecordsAreDropped() {
        assertThat(SimEvent.fromJson(null)).isNull();
        assertThat(SimEvent.fromJson("")).isNull();
        assertThat(SimEvent.fromJson("not-json")).isNull();
        // no event time / no domain ⇒ cannot be windowed
        assertThat(SimEvent.fromJson("{\"domain\":\"energy\",\"severity\":0.5}")).isNull();
        assertThat(SimEvent.fromJson("{\"tick\":10,\"severity\":0.5}")).isNull();
        // severity is optional: a missing/non-numeric value degrades to 0.0
        SimEvent noSeverity = SimEvent.fromJson("{\"domain\":\"energy\",\"tick\":10}");
        assertThat(noSeverity).isNotNull();
        assertThat(noSeverity.severity()).isEqualTo(0.0);
    }
}