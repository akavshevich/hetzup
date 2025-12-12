import fs from 'fs';
import { type } from "arktype";

const HetznerConfig = type(
	{
		"api_token": "string",
		"preferred_location": "string",
		"ssh_keys": "string[]"
	}	
);
type HetznerConfig = typeof HetznerConfig.infer;


const ServerConfig = type(
	{
		"servers": 
		{
			"name": "string"
		}
	}
);
type ServerConfig = typeof ServerConfig.infer;

export function read_hetzner_config(): HetznerConfig | false
{
	const config_raw = JSON.parse(fs.readFileSync('hetzner_config.json', 'utf-8'));
	const config = HetznerConfig(config_raw);

	if(config instanceof type.errors)
	{
		return false;
		// console.log(config_valid[0].path[0], config_valid[1].path[0]);
	}

	return config;
}

export function read_server_config(): ServerConfig | false
{
	const server_config_raw = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
	const server_config = ServerConfig(server_config_raw);

	if(server_config instanceof type.errors)
	{
		return false;
	}

	return server_config;
}

export function update_hetzner_config(updates: Partial<HetznerConfig>)
{
	const config = read_hetzner_config();
	Object.assign(config, updates);

	fs.writeFileSync('hetzner_config.json', JSON.stringify(config, null, 2), 'utf-8');
}

export function update_server_config(updates: Partial<ServerConfig>)
{
	const config = read_server_config();
	Object.assign(config, updates);

	fs.writeFileSync('servers.json', JSON.stringify(config, null, 2), 'utf-8');
}