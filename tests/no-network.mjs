// Test subprocesses must never contact LINE or paid AI providers.
globalThis.fetch = async () => {
  console.error('UNEXPECTED_TEST_NETWORK');
  throw new Error('Outbound network disabled by security tests');
};
