package com.github.saashybridagent.controlplane.dto;

import java.util.List;
import java.util.Map;

public record IngestMetricsResponse(List<Bucket> buckets) {

  public record Bucket(
      String key, long total, Map<String, Long> bySource, Map<String, Long> byKind) {}
}
