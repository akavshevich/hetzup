import fs from 'fs';
import { ArkErrors, type } from "arktype";
import { error_to_string } from './utils';

const HetznerConfig = type(
	{
		"api_token": "string",
		"preferred_location?": "string",
		"preferred_os?": "number",
		"ssh_keys?": "string[]",
		"keep_ipv4": "'yes' | 'no' | 'ask'",
		"keep_ipv6": "'yes' | 'no' | 'ask'"
	}	
);
type HetznerConfig = typeof HetznerConfig.infer;


const ServerConfig = type(
	{
		"servers": type(
			{
				name: "string | number", 
				"type?": "string", 
				"ipv4?": "string", 
				"ipv6?": "string", 
				"location?": "string",
				"ssh_keys?": "string[]",
				"last_update": "number"
			}, "[]")
	}
);
type ServerConfig = typeof ServerConfig.infer;


export function read_hetzner_config(): HetznerConfig | false
{
	try
	{
		const config_raw = JSON.parse(fs.readFileSync('hetzner_config.json', 'utf-8'));
		const config = HetznerConfig(config_raw);

		if(config instanceof type.errors)
		{
			repair_config('hetzner', config);
			return false;
		}

		return config;
	}
	catch
	{
		repair_config('hetzner');
		return false;
	}
}

export function read_server_config(): ServerConfig | false
{
	try
	{
		const server_config_raw = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
		const server_config = ServerConfig(server_config_raw);

		if(server_config instanceof type.errors)
		{
			repair_config('servers', server_config);
			return false;
		}

		return server_config;
	}
	catch
	{
		repair_config('servers');
		return false;
	}
}

export function update_hetzner_config(updates: Partial<HetznerConfig>)
{
	const config = JSON.parse(fs.readFileSync('hetzner_config.json', 'utf-8'));
	Object.assign(config, updates);

	fs.writeFileSync('hetzner_config.json', JSON.stringify(config, null, 2), 'utf-8');
}

export function update_server_config(updates: Partial<ServerConfig>)
{
	const config = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
	Object.assign(config, updates);

	fs.writeFileSync('servers.json', JSON.stringify(config, null, 2), 'utf-8');
}

function repair_config(config: 'hetzner' | 'servers', errors?: ArkErrors)
{
	switch (config)
	{
		case 'hetzner':

			if(!errors)
			{
				const blank_config = {api_token: ""};
				fs.writeFileSync('hetzner_config.json', JSON.stringify(blank_config, null, 2), 'utf-8');
				break;
			}

			const hetzner_fixes: Partial<HetznerConfig> = {};

			for (let index = 0; index < errors.length; index++)
			{
				const error = errors[index];
				const problematic_prop = error.path[0].toString();

				if(problematic_prop === 'api_token')
				{
					hetzner_fixes.api_token = '';
				}
				else if(problematic_prop === 'preferred_location')
				{
					hetzner_fixes.preferred_location = '';
				}
				else if(problematic_prop === 'ssh_keys')
				{
					hetzner_fixes.ssh_keys = [];
				}
				else if(problematic_prop === 'keep_ipv4')
				{
					hetzner_fixes.keep_ipv4 = 'ask';
				}
				else if(problematic_prop === 'keep_ipv6')
				{
					hetzner_fixes.keep_ipv6 = 'ask';
				}
				else
				{
					throw new Error('Unknown broken config property: ' + problematic_prop);
				}
			}

			try
			{
				update_hetzner_config(hetzner_fixes);
			}
			catch(error)
			{
				throw new Error('Failed to write config repairs: ' + error_to_string(error));
			}

			break;
		case 'servers':

			if(!errors)
			{
				const blank_config: ServerConfig = {servers: []};
				fs.writeFileSync('servers.json', JSON.stringify(blank_config, null, 2), 'utf-8');
				break;
			}

			const server_fixes: Partial<ServerConfig> = {};
			for (let index = 0; index < errors.length; index++)
			{
				const error = errors[index];
				const problematic_prop = error.path[0].toString();

				if(problematic_prop === 'servers')
				{
					server_fixes.servers = [];
				}
				else
				{
					throw new Error('Unknown broken config property: ' + problematic_prop);
				}
			}

			try
			{
				update_server_config(server_fixes);
			}
			catch(error)
			{
				throw new Error('Failed to write config repairs: ' + error_to_string(error));
			}

			break;
		default:
			throw new Error('Unknown config');
	}
}