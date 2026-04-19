import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

export async function fetchConfig() {
  const keyVaultUrl = process.env.KEY_VAULT_URL;
  if (!keyVaultUrl) throw new Error('KEY_VAULT_URL unset');

  const credential = new DefaultAzureCredential();
  const kv = new SecretClient(keyVaultUrl, credential);

  const [githubWebhookSecret, githubAppId, githubAppPrivateKey] = (
    await Promise.all([
      kv.getSecret('github-webhook-secret').catch(() => ({ value: null })),
      kv.getSecret('github-app-id').catch(() => ({ value: null })),
      kv.getSecret('github-app-private-key').catch(() => ({ value: null })),
    ])
  ).map((s) => s.value);

  if (!githubWebhookSecret) {
    console.warn('[config] github-webhook-secret missing — webhook receiver will reject all requests');
  }

  return {
    githubWebhookSecret,
    githubAppId,
    githubAppPrivateKey,
  };
}
