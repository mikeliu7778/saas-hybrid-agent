package com.github.saashybridagent.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.api.dto.HealthResponse;

@RestController
@RequestMapping("/v1")
public class HealthController {

  @GetMapping("/health")
  public HealthResponse health() {
    return HealthResponse.ok();
  }
}
