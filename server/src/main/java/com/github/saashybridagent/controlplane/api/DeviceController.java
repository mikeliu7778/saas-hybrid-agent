package com.github.saashybridagent.controlplane.api;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceRegistry;
import com.github.saashybridagent.controlplane.dto.DeviceRegisterRequest;
import com.github.saashybridagent.controlplane.dto.DeviceRegisterResponse;

import jakarta.validation.Valid;

@RestController
@RequestMapping("/v1/devices")
public class DeviceController {

  private final DeviceRegistry registry;

  public DeviceController(DeviceRegistry registry) {
    this.registry = registry;
  }

  @PostMapping
  public ResponseEntity<DeviceRegisterResponse> register(@Valid @RequestBody DeviceRegisterRequest request) {
    DeviceRegisterResponse response = registry.register(request.name(), request.platform());
    return ResponseEntity.status(HttpStatus.CREATED).body(response);
  }

  @DeleteMapping("/{id}")
  public ResponseEntity<Void> revoke(@PathVariable("id") String id) {
    if (!registry.revoke(id)) {
      return ResponseEntity.notFound().build();
    }
    return ResponseEntity.noContent().build();
  }
}
