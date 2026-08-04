package com.github.saashybridagent.controlplane.sync;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Service;

import com.github.saashybridagent.controlplane.dto.SyncMutation;
import com.github.saashybridagent.controlplane.dto.SyncPullResponse;

@Service
public class InMemorySyncStore {

  private final AtomicLong cursorSeq = new AtomicLong(0);
  private final Map<String, List<StoredMutation>> byUser = new ConcurrentHashMap<>();

  public int push(String userId, List<SyncMutation> mutations) {
    List<StoredMutation> store =
        byUser.computeIfAbsent(userId, ignored -> new CopyOnWriteArrayList<>());
    int accepted = 0;
    for (SyncMutation mutation : mutations) {
      long cursor = cursorSeq.incrementAndGet();
      store.add(new StoredMutation(cursor, mutation));
      accepted++;
    }
    return accepted;
  }

  public SyncPullResponse pull(String userId, String since) {
    long sinceCursor = parseCursor(since);
    List<StoredMutation> store = byUser.getOrDefault(userId, List.of());
    List<SyncMutation> mutations = new ArrayList<>();
    long latest = sinceCursor;
    for (StoredMutation stored : store) {
      if (stored.cursor() > sinceCursor) {
        mutations.add(stored.mutation());
        latest = Math.max(latest, stored.cursor());
      }
    }
    return new SyncPullResponse(Long.toString(latest), mutations);
  }

  private static long parseCursor(String since) {
    if (since == null || since.isBlank() || "0".equals(since)) {
      return 0L;
    }
    try {
      return Long.parseLong(since);
    } catch (NumberFormatException ex) {
      return 0L;
    }
  }

  record StoredMutation(long cursor, SyncMutation mutation) {}
}
