export async function createTinyModelBackend() {
  return {
    id: "wasm:fake",
    async embed(text) {
      const v = new Array(8).fill(0);
      for (let i = 0; i < text.length; i++) v[i % 8] += text.charCodeAt(i);
      return v;
    },
  };
}
