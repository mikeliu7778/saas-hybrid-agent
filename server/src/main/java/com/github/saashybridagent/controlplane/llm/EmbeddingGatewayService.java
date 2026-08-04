package com.github.saashybridagent.controlplane.llm;

import java.util.ArrayList;
import java.util.List;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.controlplane.dto.EmbeddingRequest;
import com.github.saashybridagent.controlplane.dto.EmbeddingResponse;
import com.github.saashybridagent.controlplane.dto.EmbeddingResponse.EmbeddingData;
import com.github.saashybridagent.controlplane.quota.QuotaService;

@Service
public class EmbeddingGatewayService {

  private static final String DEFAULT_MODEL = "text-embedding-3-small";

  private final QuotaService quotaService;

  public EmbeddingGatewayService(QuotaService quotaService) {
    this.quotaService = quotaService;
  }

  public EmbeddingResponse embed(EmbeddingRequest request, String userId) {
    List<String> inputs = normalizeInput(request.input());
    String model = request.model() == null || request.model().isBlank() ? DEFAULT_MODEL : request.model();
    List<EmbeddingData> data = mockEmbeddings(inputs);
    quotaService.recordEmbeddingCall(userId);
    return new EmbeddingResponse(model, data);
  }

  private static List<String> normalizeInput(Object input) {
    if (input == null) {
      return List.of("");
    }
    if (input instanceof String text) {
      return List.of(text);
    }
    if (input instanceof List<?> list) {
      List<String> out = new ArrayList<>(list.size());
      for (Object item : list) {
        out.add(item == null ? "" : item.toString());
      }
      return out;
    }
    return List.of(input.toString());
  }

  private static List<EmbeddingData> mockEmbeddings(List<String> inputs) {
    List<EmbeddingData> data = new ArrayList<>(inputs.size());
    for (int i = 0; i < inputs.size(); i++) {
      data.add(new EmbeddingData(mockVector(inputs.get(i)), i));
    }
    return data;
  }

  private static List<Double> mockVector(String text) {
    int seed = text == null ? 0 : text.hashCode();
    List<Double> vector = new ArrayList<>(4);
    for (int i = 0; i < 4; i++) {
      vector.add(((seed >> (i * 8)) & 0xFF) / 255.0);
    }
    return vector;
  }
}
