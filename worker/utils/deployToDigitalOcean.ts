export interface DigitalOceanDeploymentOptions {
    token: string;
    name: string;
    region?: string;
    size?: string;
    image?: string;
    userData?: string;
    summary?: string;
    tags?: string[];
    sshKeys?: Array<number | string>;
    waitForActive?: boolean;
    pollIntervalMs?: number;
    timeoutMs?: number;
}

export interface DigitalOceanDeploymentResult {
    dropletId: number;
    name: string;
    status: string;
    ipv4Address?: string;
    ipv6Address?: string;
    consoleUrl: string;
    createdAt: string;
}

const DIGITALOCEAN_API_URL = 'https://api.digitalocean.com/v2';
const DEFAULT_REGION = 'nyc3';
const DEFAULT_SIZE = 's-1vcpu-1gb';
const DEFAULT_IMAGE = 'docker-20-04';
const DEFAULT_POLL_INTERVAL = 5_000;
const DEFAULT_TIMEOUT = 5 * 60_000; // 5 minutes

async function createDroplet(options: DigitalOceanDeploymentOptions): Promise<DigitalOceanDeploymentResult> {
    const response = await fetch(`${DIGITALOCEAN_API_URL}/droplets`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${options.token}`,
        },
        body: JSON.stringify({
            name: options.name,
            region: options.region || DEFAULT_REGION,
            size: options.size || DEFAULT_SIZE,
            image: options.image || DEFAULT_IMAGE,
            user_data: options.userData,
            ssh_keys: options.sshKeys,
            tags: options.tags,
            backups: false,
            ipv6: true,
            monitoring: true,
        }),
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`DigitalOcean droplet creation failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const json = await response.json() as {
        droplet: {
            id: number;
            name: string;
            status: string;
            networks?: { v4?: Array<{ ip_address: string }>; v6?: Array<{ ip_address: string }> };
            created_at: string;
        };
    };

    const droplet = json.droplet;
    return {
        dropletId: droplet.id,
        name: droplet.name,
        status: droplet.status,
        ipv4Address: droplet.networks?.v4?.[0]?.ip_address,
        ipv6Address: droplet.networks?.v6?.[0]?.ip_address,
        consoleUrl: `https://cloud.digitalocean.com/droplets/${droplet.id}`,
        createdAt: droplet.created_at,
    };
}

async function getDroplet(token: string, dropletId: number): Promise<DigitalOceanDeploymentResult> {
    const response = await fetch(`${DIGITALOCEAN_API_URL}/droplets/${dropletId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
        },
    });

    if (!response.ok) {
        const errorBody = await response.text();
        throw new Error(`DigitalOcean droplet lookup failed: ${response.status} ${response.statusText} - ${errorBody}`);
    }

    const json = await response.json() as {
        droplet: {
            id: number;
            name: string;
            status: string;
            networks?: { v4?: Array<{ ip_address: string }>; v6?: Array<{ ip_address: string }> };
            created_at: string;
        };
    };
    const droplet = json.droplet;
    return {
        dropletId: droplet.id,
        name: droplet.name,
        status: droplet.status,
        ipv4Address: droplet.networks?.v4?.[0]?.ip_address,
        ipv6Address: droplet.networks?.v6?.[0]?.ip_address,
        consoleUrl: `https://cloud.digitalocean.com/droplets/${droplet.id}`,
        createdAt: droplet.created_at,
    };
}

async function waitForDropletActive(options: DigitalOceanDeploymentOptions, dropletId: number): Promise<DigitalOceanDeploymentResult> {
    const pollInterval = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL;
    const timeout = options.timeoutMs ?? DEFAULT_TIMEOUT;
    const start = Date.now();

    while (true) {
        const droplet = await getDroplet(options.token, dropletId);
        if (droplet.status === 'active' && droplet.ipv4Address) {
            return droplet;
        }

        if (Date.now() - start > timeout) {
            throw new Error(`Timed out waiting for droplet ${dropletId} to become active`);
        }

        await new Promise((resolve) => setTimeout(resolve, pollInterval));
    }
}

function buildDefaultUserData(appName: string, summary?: string): string {
    const safeSummary = (summary ?? 'Generated application deployed by Vibe')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/`/g, '\\`');
    const safeName = appName
        .toLowerCase()
        .replace(/[^a-z0-9-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '') || 'vibe-app';
    const html = [
        '<!DOCTYPE html>',
        '<html lang="en">',
        '<head>',
        '  <meta charset="utf-8" />',
        `  <title>${safeName} deployment</title>`,
        '  <style>',
        '    body { font-family: sans-serif; padding: 2rem; background: #0f172a; color: #f8fafc; }',
        '    main { max-width: 720px; margin: 0 auto; }',
        '    h1 { font-size: 2rem; margin-bottom: 1rem; }',
        '    p { line-height: 1.6; }',
        '    code { background: rgba(15, 23, 42, 0.6); padding: 0.25rem 0.5rem; border-radius: 0.375rem; }',
        '  </style>',
        '</head>',
        '<body>',
        '  <main>',
        `    <h1>${safeName}</h1>`,
        `    <p>${safeSummary}</p>`,
        '    <p>Update this droplet by SSHing into it and replacing the contents of <code>/var/www/html</code>.</p>',
        '  </main>',
        '</body>',
        '</html>',
    ].join('\n');

    return `#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y nginx
cat <<'EOF_HTML' >/var/www/html/index.html
${html}
EOF_HTML
systemctl enable nginx
systemctl restart nginx
`;
}

export async function deployToDigitalOceanDroplet(options: DigitalOceanDeploymentOptions): Promise<DigitalOceanDeploymentResult> {
    const createdDroplet = await createDroplet({
        ...options,
        userData: options.userData ?? buildDefaultUserData(options.name, options.summary),
    });

    if (options.waitForActive === false) {
        return createdDroplet;
    }

    return waitForDropletActive(options, createdDroplet.dropletId);
}
