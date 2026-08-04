package com.github.saashybridagent.controlplane.auth;

import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.controlplane.dto.DeviceRegisterResponse;

@Service
public class DeviceRegistry {

  private final Map<String, DeviceRecord> byId = new ConcurrentHashMap<>();
  private final Map<String, String> tokenToDeviceId = new ConcurrentHashMap<>();

  public DeviceRegisterResponse register(String name, String platform) {
    String deviceId = UUID.randomUUID().toString();
    String token = UUID.randomUUID().toString().replace("-", "");
    String userId = UUID.nameUUIDFromBytes((name + ":" + platform).getBytes()).toString();
    DeviceRecord record = new DeviceRecord(deviceId, token, userId, false);
    byId.put(deviceId, record);
    tokenToDeviceId.put(token, deviceId);
    return new DeviceRegisterResponse(deviceId, token, userId);
  }

  public boolean revoke(String deviceId) {
    DeviceRecord existing = byId.get(deviceId);
    if (existing == null || existing.revoked()) {
      return false;
    }
    DeviceRecord revoked = existing.revoke();
    byId.put(deviceId, revoked);
    tokenToDeviceId.remove(existing.token());
    return true;
  }

  public Optional<DeviceRecord> findByToken(String token) {
    if (token == null || token.isBlank()) {
      return Optional.empty();
    }
    String deviceId = tokenToDeviceId.get(token);
    if (deviceId == null) {
      return Optional.empty();
    }
    DeviceRecord record = byId.get(deviceId);
    if (record == null || record.revoked()) {
      return Optional.empty();
    }
    return Optional.of(record);
  }

  public Optional<DeviceRecord> findById(String deviceId) {
    return Optional.ofNullable(byId.get(deviceId));
  }
}
