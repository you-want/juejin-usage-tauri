/** Use Chromium's system proxy/PAC support for desktop account requests. */
export const fetchSubscription: typeof fetch = async (input, init) => {
  // Load only when called after app.ready; reader unit tests run in plain Node.
  const { net } = await import('electron');
  return net.fetch(input instanceof URL ? input.href : input, {
    ...init,
    // Account authorization comes from the explicit bearer, never session cookies.
    credentials: 'omit',
  });
};
