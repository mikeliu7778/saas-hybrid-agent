package com.github.saashybridagent.auth;

import java.io.IOException;

import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.github.saashybridagent.api.dto.ErrorResponse;
import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.auth.DeviceAuthContext;
import com.github.saashybridagent.controlplane.auth.DeviceRecord;
import com.github.saashybridagent.controlplane.auth.DeviceRegistry;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

public class BearerTokenFilter extends OncePerRequestFilter {

  private static final String HEALTH_PATH = "/v1/health";
  private static final String DEVICES_PATH = "/v1/devices";
  private static final String BEARER_PREFIX = "Bearer ";

  private final ObjectMapper objectMapper;
  private final DeviceRegistry deviceRegistry;

  public BearerTokenFilter(ObjectMapper objectMapper, DeviceRegistry deviceRegistry) {
    this.objectMapper = objectMapper;
    this.deviceRegistry = deviceRegistry;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    String uri = request.getRequestURI();
    String method = request.getMethod();

    if (HEALTH_PATH.equals(uri)
        || (HttpMethod.POST.matches(method) && DEVICES_PATH.equals(uri))) {
      filterChain.doFilter(request, response);
      return;
    }

    if (requiresDeviceAuth(method, uri)) {
      String token = extractBearerToken(request);
      if (token != null) {
        var device = deviceRegistry.findByToken(token);
        if (device.isPresent()) {
          DeviceRecord record = device.get();
          request.setAttribute(DeviceAuthAttributes.USER_ID, record.userId());
          request.setAttribute(DeviceAuthAttributes.DEVICE_ID, record.deviceId());
          request.setAttribute(
              DeviceAuthAttributes.CONTEXT,
              new DeviceAuthContext(record.deviceId(), record.userId()));
          filterChain.doFilter(request, response);
          return;
        }
      }
      unauthorized(response);
      return;
    }

    unauthorized(response);
  }

  private static boolean requiresDeviceAuth(String method, String uri) {
    if (uri.startsWith("/v1/llm/")
        || uri.startsWith("/v1/sync/")
        || uri.startsWith("/v1/trust/")) {
      return true;
    }
    if ("/v1/quota".equals(uri)) {
      return true;
    }
    return HttpMethod.DELETE.matches(method) && uri.startsWith("/v1/devices/");
  }

  private static String extractBearerToken(HttpServletRequest request) {
    String authorization = request.getHeader(HttpHeaders.AUTHORIZATION);
    if (authorization != null && authorization.startsWith(BEARER_PREFIX)) {
      return authorization.substring(BEARER_PREFIX.length());
    }
    return null;
  }

  private void unauthorized(HttpServletResponse response) throws IOException {
    response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
    objectMapper.writeValue(
        response.getOutputStream(),
        ErrorResponse.of("unauthorized", "Missing or invalid bearer token"));
  }
}
