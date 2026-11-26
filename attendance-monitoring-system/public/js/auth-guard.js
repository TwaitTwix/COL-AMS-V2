export function requireAuthClient(authClient, setMessage) {
  if (authClient) return authClient;

  if (typeof setMessage === "function") {
    setMessage("Please wait while sign-in loads…", "error");
  }

  return null;
}
