package com.github.saashybridagent.controlplane.ingest;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.controlplane.dto.IngestAnalyticsEventDto;
import com.github.saashybridagent.controlplane.dto.IngestEventsResponse;
import com.github.saashybridagent.controlplane.dto.IngestMetricsResponse;

/** I3b — append-only ingest analytics (metadata only; no Memory rewrite). */
@Service
public class InMemoryIngestEventStore {

  private static final Set<String> VALID_SOURCES =
      Set.of(
          "cursor",
          "claude_code",
          "codex",
          "hybrid",
          "continue",
          "aider",
          "opencode",
          "dev_companion",
          "other");

  private static final Set<String> VALID_KINDS =
      Set.of("session_summary", "file_touch", "decision", "procedure_draft", "raw_marker");

  private final Map<String, Map<String, StoredEvent>> byUser = new ConcurrentHashMap<>();

  public IngestEventsResponse append(String userId, List<IngestAnalyticsEventDto> events) {
    if (events == null || events.isEmpty()) {
      throw new IllegalArgumentException("events must not be empty");
    }
    for (IngestAnalyticsEventDto event : events) {
      validate(event);
    }

    Map<String, StoredEvent> store =
        byUser.computeIfAbsent(userId, ignored -> new ConcurrentHashMap<>());
    int accepted = 0;
    int duplicates = 0;
    for (IngestAnalyticsEventDto event : events) {
      StoredEvent stored =
          new StoredEvent(
              event.eventId(),
              event.source(),
              event.kind(),
              event.ts(),
              event.pathCount() == null ? 0 : Math.max(0, event.pathCount()));
      StoredEvent previous = store.putIfAbsent(event.eventId(), stored);
      if (previous == null) {
        accepted++;
      } else {
        duplicates++;
      }
    }
    return new IngestEventsResponse(accepted, duplicates);
  }

  public IngestMetricsResponse metrics(String userId, Instant from, Instant to, String grain) {
    if (grain != null && !grain.isBlank() && !"day".equals(grain)) {
      throw new IllegalArgumentException("unsupported grain: " + grain + " (only day)");
    }

    Map<String, StoredEvent> store = byUser.getOrDefault(userId, Map.of());
    Map<String, MutableBucket> buckets = new LinkedHashMap<>();

    for (StoredEvent event : store.values()) {
      Instant ts = event.ts();
      if (from != null && ts.isBefore(from)) {
        continue;
      }
      if (to != null && !ts.isBefore(to)) {
        continue;
      }
      String key = LocalDate.ofInstant(ts, ZoneOffset.UTC).toString();
      MutableBucket bucket = buckets.computeIfAbsent(key, ignored -> new MutableBucket());
      bucket.total++;
      bucket.bySource.merge(event.source(), 1L, Long::sum);
      bucket.byKind.merge(event.kind(), 1L, Long::sum);
    }

    List<IngestMetricsResponse.Bucket> result = new ArrayList<>();
    buckets.entrySet().stream()
        .sorted(Map.Entry.comparingByKey(Comparator.naturalOrder()))
        .forEach(
            entry -> {
              MutableBucket b = entry.getValue();
              result.add(
                  new IngestMetricsResponse.Bucket(
                      entry.getKey(), b.total, Map.copyOf(b.bySource), Map.copyOf(b.byKind)));
            });
    return new IngestMetricsResponse(result);
  }

  private static void validate(IngestAnalyticsEventDto event) {
    if (event == null) {
      throw new IllegalArgumentException("event must not be null");
    }
    requireNonBlank(event.eventId(), "eventId");
    requireNonBlank(event.source(), "source");
    requireNonBlank(event.kind(), "kind");
    if (event.ts() == null) {
      throw new IllegalArgumentException("ts is required");
    }
    if (!VALID_SOURCES.contains(event.source())) {
      throw new IllegalArgumentException("invalid source: " + event.source());
    }
    if (!VALID_KINDS.contains(event.kind())) {
      throw new IllegalArgumentException("invalid kind: " + event.kind());
    }
  }

  private static void requireNonBlank(String value, String field) {
    if (value == null || value.isBlank()) {
      throw new IllegalArgumentException(field + " is required");
    }
  }

  private static final class MutableBucket {
    long total;
    final Map<String, Long> bySource = new LinkedHashMap<>();
    final Map<String, Long> byKind = new LinkedHashMap<>();
  }

  record StoredEvent(String eventId, String source, String kind, Instant ts, int pathCount) {}
}
