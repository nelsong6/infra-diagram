import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

export async function fetchConfig() {
  const keyVaultUrl = process.env.KEY_VAULT_URL;
  if (!keyVaultUrl) {
    console.warn('[config] KEY_VAULT_URL unset - running without Key Vault backed GitHub app secrets');
    return {
      githubWebhookSecret: null,
      githubAppId: null,
      githubAppPrivateKey: null,
      codexQueueJwtSecret: process.env.CODEX_QUEUE_JWT_SECRET ?? null,
    };
  }

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(keyVaultUrl, credential);

  const [githubWebhookSecret, githubAppId, githubAppPrivateKey, codexQueueJwtSecret] = (
    await Promise.all([
      kv.getSecret('github-webhook-secret').catch(() => ({ value: null })),
      kv.getSecret('github-app-id').catch(() => ({ value: null })),
      kv.getSecret('github-app-private-key').catch(() => ({ value: null })),
      kv.getSecret('codex-queue-jwt-secret').catch(() => ({ value: process.env.CODEX_QUEUE_JWT_SECRET ?? null })),
    ])
  ).map((s) => s.value);

  if (!githubWebhookSecret) {
    console.warn('[config] github-webhook-secret missing — webhook receiver will reject all requests');
  }

  return {
    githubWebhookSecret,
    githubAppId,
    githubAppPrivateKey,
    codexQueueJwtSecret,
  };
}
