import fs from 'fs';
import { promisify } from 'node:util';
import child_process from 'node:child_process';

import { ArkErrors, type } from "arktype";
import { error_to_string } from './utils';
import { Server } from './types';
import { show_info } from './interaction';

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

export const PortsConfig = type(
	{
		"ssh?": {"local": "0 < number < 65535", "remote": "0 < number < 65535"},
		"domains?": "string[]"
	}
);
export type PortsConfig = typeof PortsConfig.infer;

export const ServerConfig = type(
	{
		name: "string | number", 
		"type?": "string", 
		"ipv4?": "string", 
		"ipv6?": "string", 
		"location?": "string",
		"ssh_keys?": "string[]",
		"last_update": "number",
		"ports?": PortsConfig
	}
);
export type ServerConfig = typeof ServerConfig.infer;

const ServersConfig = type(
	{
		"servers": type(ServerConfig, "[]")
	}
);
type ServersConfig = typeof ServersConfig.infer;


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

export function read_server_config(): ServersConfig | false
{
	try
	{
		const server_config_raw = JSON.parse(fs.readFileSync('servers.json', 'utf-8'));
		const server_config = ServersConfig(server_config_raw);

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

export function update_server_config(updates: Partial<ServersConfig>)
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
				const blank_config: ServersConfig = {servers: []};
				fs.writeFileSync('servers.json', JSON.stringify(blank_config, null, 2), 'utf-8');
				break;
			}

			const server_fixes: Partial<ServersConfig> = {};
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

export async function enable_nginx_config(server: Server, ports_config: PortsConfig)
{
	if(server.status !== 'running')
	{
		throw new Error(`${server.name} is currently inactive.`);
	}

	let remote_ip: false | string = false;
	if(server.ipv4)
	{
		remote_ip = server.ipv4;
	}
	else if(server.ipv6)
	{
		remote_ip = `[${server.ipv6.replace('/64', '1')}]`;
	}
	
	if(!remote_ip)
	{
		throw new Error(`${server.name} has no reachable IP address!`);
	}

	try
	{
		fs.accessSync('/etc/nginx/', fs.constants.R_OK | fs.constants.W_OK);
		fs.accessSync('/etc/nginx/nginx.conf', fs.constants.R_OK | fs.constants.W_OK);
		fs.accessSync('/etc/nginx/sites-available/', fs.constants.R_OK | fs.constants.W_OK);
		fs.accessSync('/etc/nginx/sites-enabled/', fs.constants.R_OK | fs.constants.W_OK);
	}
	catch(error)
	{
		throw new Error('Nginx is either not installed or Hetzup has no access to /etc/nginx/ folder!');
	}

	try
	{
		if(!fs.existsSync('/etc/nginx/hetzup/'))
		{
			fs.mkdirSync('/etc/nginx/hetzup');

			if(!fs.existsSync('/etc/nginx/hetzup/'))
			{
				throw new Error('Failed to create /etc/nginx/hetzup/ folder.');
			}
		}
	}
	catch(error)
	{
		throw new Error('Failed to create /etc/nginx/hetzup/ folder.');
	}

	try
	{
		const config_file = fs.readFileSync('/etc/nginx/nginx.conf', 'utf8');
		const config_file_lines = config_file.split('\n');

		const found_includes = [];
		let stream_directive_open_line: number | boolean = false;

		for (let i = 0; i < config_file_lines.length; i++)
		{
			if(config_file_lines[i].trim() === 'include /etc/nginx/hetzup/*;')
			{
				found_includes.push({index: i, commented: false});
			}

			if(config_file_lines[i].trim() === '# include /etc/nginx/hetzup/*;' || config_file_lines[i].trim() === '#include /etc/nginx/hetzup/*;')
			{
				found_includes.push({index: i, commented: true});
			}

			if(config_file_lines[i].trim() === 'stream {' || config_file_lines[i].trim() === 'stream{')
			{
				stream_directive_open_line = i;
			}
		}

		if(found_includes.length === 0 && !stream_directive_open_line)
		{
			config_file_lines.push('stream {');
			config_file_lines.push('	include /etc/nginx/hetzup/*;');
			config_file_lines.push('}');
		}
		else if (found_includes.length === 0 && typeof stream_directive_open_line === 'number')
		{
			config_file_lines.splice(stream_directive_open_line + 1, 0, '	include /etc/nginx/hetzup/*;');
		}
		else
		{
			let config_enabled = false;
			for(const hetzup_include_line of found_includes)
			{
				if(hetzup_include_line.commented)
				{
					if(!config_enabled)
					{
						config_file_lines[hetzup_include_line.index] = '	include /etc/nginx/hetzup/*;';
						config_enabled = true;
						continue;
					}
					else
					{
						delete config_file_lines[hetzup_include_line.index];
					}
				}
				else
				{
					if(config_enabled)
					{
						delete config_file_lines[hetzup_include_line.index];
						continue;
					}

					config_enabled = true;
				}
			}
		}

		const new_nginx_conf = config_file_lines.filter(function (e) {return e;}).join('\n');
		fs.writeFileSync('/etc/nginx/nginx.conf', new_nginx_conf, 'utf-8');
	}
	catch
	{
		throw new Error('Failed to read or write to /etc/nginx/nginx.conf');
	}

	try
	{
		if(ports_config.ssh)
		{
			let ssh_config = fs.readFileSync('templates/ssh', 'utf8');

			ssh_config = ssh_config.replaceAll('{{server_name}}', server.name.toString());
			ssh_config = ssh_config.replaceAll('{{remote_ip}}', remote_ip);
			ssh_config = ssh_config.replaceAll('{{remote_port}}', ports_config.ssh.remote.toString());
			ssh_config = ssh_config.replaceAll('{{local_port}}', ports_config.ssh.local.toString());

			fs.writeFileSync(`/etc/nginx/hetzup/${server.name}`, ssh_config, 'utf-8');
		}
	}
	catch
	{
		throw new Error('Failed to create or update Nginx config for SSH forwarding.');
	}

	try
	{
		for (const file of fs.readdirSync('/etc/nginx/sites-enabled/')) 
		{
			if(file.includes(`hetzup_${server.name}_`))
			{
				fs.unlinkSync('/etc/nginx/sites-enabled/' + file);
			}
		}

		if(ports_config.domains)
		{
			const domain_forwarding_template = fs.readFileSync('templates/http', 'utf8');

			for (const domain of ports_config.domains)
			{
				if(fs.existsSync(`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`))
				{
					const domain_config = fs.readFileSync(`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`, 'utf8');
					const domain_config_lines = domain_config.split('\n');

					for (let i = 0; i < domain_config_lines.length; i++)
					{
						if(domain_config_lines[i].includes('proxy_pass http://'))
						{
							domain_config_lines[i] = '		proxy_pass http://{{remote_ip}}:80;'.replace('{{remote_ip}}', remote_ip);
						}
					}

					const new_domain_config = domain_config_lines.join('\n');
					fs.writeFileSync(`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`, new_domain_config, 'utf-8');
					fs.symlinkSync(
						`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`, `/etc/nginx/sites-enabled/hetzup_${server.name}_${domain}`
					);
					continue;
				}

				let domain_config = domain_forwarding_template;

				let ssl = await handle_ssl(domain);
				domain_config = domain_config.replace('{{ssl_certificate}}', `ssl_certificate ${ssl.ssl_certificate};`);
				domain_config = domain_config.replace('{{ssl_certificate_key}}', `ssl_certificate_key ${ssl.ssl_certificate_key};`);

				domain_config = domain_config.replaceAll('{{domain_name}}', domain);
				domain_config = domain_config.replaceAll('{{remote_ip}}', remote_ip);

				if(!ssl.genuine)
				{
					await show_info(
						`Couldn't locate certificate for ${domain}, using self signed. Edit config in /etc/nginx/sites-available/ to add manually.`
					);
				}

				fs.writeFileSync(`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`, domain_config, 'utf-8');
				fs.symlinkSync(`/etc/nginx/sites-available/hetzup_${server.name}_${domain}`, `/etc/nginx/sites-enabled/hetzup_${server.name}_${domain}`);
			}
		}
	}
	catch(error)
	{
		throw new Error('Failed to create or update Nginx config for domain forwarding.');
	}

	try
	{
		await reload_nginx_config();
	}
	catch
	{
		throw new Error('Failed to reload Nginx config.');
	}
}

export async function handle_ssl(domain: string)
{
	let ssl_certificate = '/etc/letsencrypt/live/{{domain_name}}/fullchain.pem;'.replace('{{domain_name}}', domain);
	let ssl_certificate_key = '/etc/letsencrypt/live/{{domain_name}}/privkey.pem;'.replace('{{domain_name}}', domain);

	if(fs.existsSync(ssl_certificate) && fs.existsSync(ssl_certificate_key))
	{
		return {ssl_certificate, ssl_certificate_key, genuine: true};
	}

	if(!fs.existsSync('/etc/nginx/hetzup_ssl/'))
	{
		fs.mkdirSync('/etc/nginx/hetzup_ssl');

		if(!fs.existsSync('/etc/nginx/hetzup_ssl/'))
		{
			throw new Error('Failed to create /etc/nginx/hetzup_ssl folder.');
		}
	}

	if(fs.existsSync('/etc/nginx/hetzup_ssl/key.pem') && fs.existsSync('/etc/nginx/hetzup_ssl/cert.pem'))
	{
		return {ssl_certificate: '/etc/nginx/hetzup_ssl/cert.pem', ssl_certificate_key: '/etc/nginx/hetzup_ssl/key.pem', genuine: false};
	}

	try
	{
		const exec = promisify(child_process.exec);
		await exec('openssl req -x509 -newkey rsa:2048 -keyout /etc/nginx/hetzup_ssl/key.pem -out /etc/nginx/hetzup_ssl/cert.pem -days 365 -nodes -subj "/C=XX/ST=StateName/L=CityName/O=CompanyName/OU=CompanySectionName/CN=CommonNameOrHostname"');
	}
	catch
	{
		throw new Error('OpenSSL command failed to execute');
	}

	if(!fs.existsSync('/etc/nginx/hetzup_ssl/key.pem') || !fs.existsSync('/etc/nginx/hetzup_ssl/cert.pem'))
	{
		throw new Error('Failed to generate self signed certificate');
	}

	return {ssl_certificate: '/etc/nginx/hetzup_ssl/cert.pem', ssl_certificate_key: '/etc/nginx/hetzup_ssl/key.pem', genuine: false};
}

async function reload_nginx_config()
{
	const exec = promisify(child_process.exec);
	await exec('nginx -s reload');
	return;
}

export async function disable_server_config(server_name: string)
{
	try
	{
		fs.unlinkSync(`/etc/nginx/hetzup/${server_name}`);

		for (const file of fs.readdirSync('/etc/nginx/sites-enabled/')) 
		{
			if(file.includes(`hetzup_${server_name}_`))
			{
				fs.unlinkSync('/etc/nginx/sites-enabled/' + file);
			}
		}
	}
	catch
	{
		throw new Error('Failed to disable domain config for ' + server_name);
	}
}