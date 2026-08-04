package com.github.saashybridagent.controlplane.auth;

public record DeviceRecord(String deviceId, String token, String userId, boolean revoked) {

  public DeviceRecord revoke() {
    return new DeviceRecord(deviceId, token, userId, true);
  }
}
