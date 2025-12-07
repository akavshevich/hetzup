import fs from 'fs';

export function read_hetzner_config(): {api_token: string, preferred_location: string, ssh_keys: string[]}
{
	const config = JSON.parse(fs.readFileSync('hetzner_config.json', 'utf-8'));
	return config;
}

export function read_server_list(): [{name: string}]
{
	const server_list = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
	return server_list.servers;
}