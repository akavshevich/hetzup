import fs from 'fs';

type HetznerConfig = {api_token: string, preferred_location: string, ssh_keys: string[]};
type ServerConfig = {servers: {name: string}[]};

export function read_hetzner_config(): HetznerConfig
{
	const config = JSON.parse(fs.readFileSync('hetzner_config.json', 'utf-8'));
	return config;
}

export function read_server_list(): ServerConfig
{
	const server_list = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
	return server_list;
}

export function update_hetzner_config(updates: Partial<HetznerConfig>)
{
	const config: HetznerConfig = read_hetzner_config();
	Object.assign(config, updates);

	fs.writeFileSync('hetzner_config.json', JSON.stringify(config), 'utf-8');
}

export function update_server_config(updates: Partial<ServerConfig>)
{
	const config: ServerConfig = read_server_list();
	Object.assign(config, updates);
	console.log(config);

	fs.writeFileSync('servers.json', JSON.stringify(config), 'utf-8');
}