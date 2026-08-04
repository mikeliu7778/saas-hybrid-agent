package com.github.saashybridagent.controlplane.api;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestAttribute;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import com.github.saashybridagent.controlplane.auth.DeviceAuthAttributes;
import com.github.saashybridagent.controlplane.dto.QuotaResponse;
import com.github.saashybridagent.controlplane.quota.QuotaService;

@RestController
@RequestMapping("/v1/quota")
public class QuotaController {

  private final QuotaService quotaService;

  public QuotaController(QuotaService quotaService) {
    this.quotaService = quotaService;
  }

  @GetMapping
  public QuotaResponse quota(@RequestAttribute(DeviceAuthAttributes.USER_ID) String userId) {
    return quotaService.getQuota(userId);
  }
}
