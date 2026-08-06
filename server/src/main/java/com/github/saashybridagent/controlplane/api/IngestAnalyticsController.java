package com.github.saashybridagent.controlplane.api;

import java.time.Instant;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.IngestEventsRequest;
import com.github.saashybridagent.controlplane.dto.IngestEventsResponse;
import com.github.saashybridagent.controlplane.dto.IngestMetricsResponse;
import com.github.saashybridagent.controlplane.ingest.InMemoryIngestEventStore;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/ingest")
public class IngestAnalyticsController {

  private final InMemoryIngestEventStore ingestEventStore;

  public IngestAnalyticsController(InMemoryIngestEventStore ingestEventStore) {
    this.ingestEventStore = ingestEventStore;
  }

  @PostMapping("/events")
  public IngestEventsResponse appendEvents(
      @Valid @RequestBody IngestEventsRequest request,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return ingestEventStore.append(userId, request.events());
  }

  @GetMapping("/metrics")
  public IngestMetricsResponse metrics(
      @RequestParam(name = "from", required = false) Instant from,
      @RequestParam(name = "to", required = false) Instant to,
      @RequestParam(name = "grain", defaultValue = "day") String grain,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return ingestEventStore.metrics(userId, from, to, grain);
  }
}
