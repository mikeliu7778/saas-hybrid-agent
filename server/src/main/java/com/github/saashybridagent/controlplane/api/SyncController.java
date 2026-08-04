package com.github.saashybridagent.controlplane.api;

import java.util.Map;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.SyncPullResponse;
import com.github.saashybridagent.controlplane.dto.SyncPushRequest;
import com.github.saashybridagent.controlplane.sync.InMemorySyncStore;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/sync")
public class SyncController {

  private final InMemorySyncStore syncStore;

  public SyncController(InMemorySyncStore syncStore) {
    this.syncStore = syncStore;
  }

  @PostMapping("/push")
  public Map<String, Integer> push(
      @Valid @RequestBody SyncPushRequest request,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    int accepted = syncStore.push(userId, request.mutations());
    return Map.of("accepted", accepted);
  }

  @GetMapping("/pull")
  public SyncPullResponse pull(
      @RequestParam(name = "since", defaultValue = "0") String since,
      @RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return syncStore.pull(userId, since);
  }
}
