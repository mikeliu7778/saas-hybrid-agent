package com.github.saashybridagent.controlplane.dto;

import jakarta.validation.constraints.NotBlank;

public record DeviceRegisterRequest(@NotBlank String name, @NotBlank String platform) {}
