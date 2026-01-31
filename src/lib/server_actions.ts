import ora, { Ora } from 'ora';

import { disable_server_config, enable_nginx_config, read_hetzner_config, read_server_config, ServerConfig, update_server_config } from './configs';
import { log_error, error_to_string, sleep, format_date } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, get_snapshot, delete_server, spin_up_server, get_server, delete_snapshot, rebuild_server_from_image, get_primary_ips, delete_primary_ip, change_ip_auto_delete_status, get_os_images } from './api_calls';
import { NewServerConfig, NewServerDetails, OSImage, PrimaryIP, Server, ServerList, ServerType } from './types';
import { show_info } from './interaction';
import chalk from 'chalk';

export async function generate_server_list(): Promise< ServerList >
{
	let running_servers;
	let snapshots;

	try
	{
		[running_servers, snapshots] = await Promise.all(
			[
				get_running_servers(),
				get_snapshots()
			]
		);
	}
	catch (error)
	{
		throw error;
	}

	const servers: ServerList = new Map();

	for(const server of running_servers)
	{
		servers.set(
			server.name, 
			{
				id: server.id, 
				name: server.name, 
				status: 'running', 
				snapshots: [], 
				cores: server.cores, 
				disk: server.disk, 
				memory: server.memory,
				type: server.type,
				ipv4: server.ipv4, 
				ipv6: server.ipv6,
				location: server.location
			}
		);
	}

	for(const snapshot of snapshots)
	{
		const existing_server = servers.get(snapshot.name);

		if(!existing_server)
		{
			servers.set(
				snapshot.name, 
				{
					id: snapshot.id, 
					name: snapshot.name, 
					status: 'inactive', 
					snapshots: [{id: snapshot.id, date: snapshot.date, disk: snapshot.disk, architecture: snapshot.architecture}], disk: snapshot.disk}
			);
			continue;
		}

		const updated_server_details: Server = 
		{
			id: existing_server.id,
			name: existing_server.name,
			status: existing_server.status, 
			snapshots: [...existing_server.snapshots, {id: snapshot.id, date: snapshot.date, disk: snapshot.disk, architecture: snapshot.architecture}],
			disk: existing_server.disk,
			type: existing_server.type,
			ipv4: existing_server.ipv4, 
			ipv6: existing_server.ipv6,
			location: existing_server.location
		};

		if(existing_server.status === 'inactive')
		{
			updated_server_details.id = snapshot.id; // Hetzner sorts snapshots from oldest to newest, that way the latest will be here
			updated_server_details.disk = snapshot.disk;
		}
		else
		{
			updated_server_details.cores = existing_server.cores;
			updated_server_details.memory = existing_server.memory;
		}

		servers.set(
			snapshot.name, 
			updated_server_details
		);
		
	}

	const servers_in_config = read_server_config();
	if(servers_in_config && servers.size > 0)
	{
		for (let i = 0; i < servers_in_config.servers.length; i++)
		{
			const server_in_config = servers_in_config.servers[i];
			if(!servers.has(server_in_config.name))
			{
				delete servers_in_config.servers[i];
			}
		}

		const new_server_config = servers_in_config.servers.filter(function (e) {return e;});
		update_server_config({servers: new_server_config});
	}

	return servers;
}

export async function save_server_to_snapshot(server: Server): Promise< void >
{
	const spinner = ora({text: `Initializing new snapshot for ${server.name}...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const new_snapshot_id = await initialize_snapshot_save(server);

		spinner.color = 'green';
		spinner.text = `Saving ${server.name} to snapshot...`;

		return new Promise(
			function (resolve)
			{
				const check_on_snapshot = setInterval(
					async function ()
					{
						const snapshot_details = await get_snapshot(new_snapshot_id);
						if(snapshot_details.status !== 'available')
						{
							return;
						}

						clearInterval(check_on_snapshot);
						spinner.stop();
						resolve();
					},
					2000
				);
			}
		);
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function stop_server(server: Server, mode: 'save_stop' | 'stop' = 'save_stop')
{
	const stop_server_spinner = ora({text: `Stopping ${server.name}...`, spinner: 'point', color: 'red'});

	try
	{
		if(mode === 'save_stop')
		{
			await save_server_to_snapshot(server);
			
			try
			{
				create_config_for_server(server);
			}
			catch{}
		}

		stop_server_spinner.start();
		await delete_server(server);
		stop_server_spinner.stop();
	}
	catch (error) 
	{
		stop_server_spinner.stop();
		throw new Error(error_to_string(error));
	}
}

function ip_config_to_hetzner_format(ipv4: string, ipv6: string, available_ips?: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; } )
{
	const ip_config: { "enable_ipv4": boolean, "enable_ipv6": boolean, "ipv4": null | number, "ipv6": null | number } =
	{
		"enable_ipv4": false,
		"enable_ipv6": false,
		"ipv4": null,
		"ipv6": null
	};

	if(ipv4 !== 'none')
	{
		ip_config.enable_ipv4 = true;

		if(ipv4 !== 'new' && available_ips)
		{
			const ipv4_id = get_ip_id(ipv4, 'ipv4', available_ips);
			if(typeof ipv4_id === 'number')
			{
				ip_config.ipv4 = ipv4_id;
			}
		}
	}

	if(ipv6 !== 'none')
	{
		ip_config.enable_ipv6 = true;

		if(ipv6 !== 'new' && available_ips)
		{
			const ipv6_id = get_ip_id(ipv6, 'ipv6', available_ips);
			if(typeof ipv6_id === 'number')
			{
				ip_config.ipv6 = ipv6_id;
			}
		}
	}

	return ip_config;
}

async function spin_up_visual(new_server_details: NewServerDetails, spinner: Ora, ssh_keys: string[], ipv4: string, ipv6: string): Promise< Server > 
{
		return new Promise(
			function (resolve)
			{
				const check_on_server = setInterval(
					async function ()
					{
						const server_details = await get_server(new_server_details.id);
						
						if(server_details.status === 'starting')
						{
							spinner.color = 'green';
						}
						
						if(server_details.status !== 'running')
						{
							const capitalized_status = String(server_details.status).charAt(0).toUpperCase() + String(server_details.status).slice(1);
							spinner.text = `${capitalized_status} ${server_details.name}...`;
							return;
						}


						clearInterval(check_on_server);
						spinner.stop();

						if(server_details.ipv4 !== 'none')
						{
							ipv4 = server_details.ipv4;
						}

						if(server_details.ipv6 !== 'none')
						{
							ipv6 = server_details.ipv6;
						}

						const server: Server = 
						{
							id: server_details.id,
							name: server_details.name,
							status: "running",
							snapshots: [],
							disk: server_details.disk,
							ipv4,
							ipv6
						};

						try
						{
							create_config_for_server(
								server, 
								{
									name: server_details.name, 
									location: server_details.location, 
									type: server_details.type,
									ssh_keys: ssh_keys,
									ipv4,
									ipv6,
								}
							);

							await enable_nginx_config(server);
						}
						catch{}

						if(new_server_details.root_password)
						{
							await show_info(`Root password for ${server_details.name}: ${chalk.cyan(new_server_details.root_password)} It will not be shown again!`);
						}

						resolve(server_details);
					},
					2000
				);
			}
		);
}

export async function spin_up_from_snapshot(
						server: Server, 
						type: string, 
						location: string,
						ssh_keys: string[], 
						ipv4: string,
						ipv6: string,
						available_ips?: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; },
						latest: boolean = true, 
						snapshot_id?: string | number): Promise< Server >
{
	if(server.status !== 'inactive')
	{
		throw new Error(`${server.name} is already running`);
	}

	if(latest || !snapshot_id)
	{
		snapshot_id = server.id;
	}

	const ip_config = ip_config_to_hetzner_format(ipv4, ipv6, available_ips);

	const spinner = ora({text: `Initializing ${server.name}...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const new_server_details = await spin_up_server(snapshot_id, server.name, type, location, ssh_keys, ip_config);

		return await spin_up_visual(new_server_details, spinner, ssh_keys, ipv4, ipv6);
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}

}

export async function delete_snapshot_visual(snapshot_id: number | string)
{
	const spinner = ora({text: 'Deleting snapshot...', spinner: 'point', color: 'red'}).start();
	try
	{
		await delete_snapshot(snapshot_id);
		spinner.stop();
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function revert_to_snapshot(server: Server, snapshot_id: number | string): Promise<void>
{
	const snapshot_details = get_snapshot_details(server, snapshot_id);
	const spinner = ora(
		{text: `Reverting ${server.name} to a snapshot from ${format_date(snapshot_details.date)}...`, spinner: 'point', color: 'cyan'}
	).start();

	try
	{
		await rebuild_server_from_image(server, snapshot_id);

		return new Promise<void>(
			function (resolve)
			{
				const check_on_server = setInterval(
					async function ()
					{
						const server_details = await get_server(server.id);

						if(server_details.status !== 'running')
						{
							const capitalized_status = String(server_details.status).charAt(0).toUpperCase() + String(server_details.status).slice(1);
							spinner.text = `${capitalized_status} ${server.name}...`;
							return;
						}

						clearInterval(check_on_server);
						spinner.stop();
						resolve();
					},
					2000
				);
			}
		);
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function complete_server_removal(server: Server)
{
	const spinner = ora({text: 'Deleting snapshot...', spinner: 'point', color: 'red'}).start();
	
	try
	{
		for (let index = 0; index < server.snapshots.length; index++)
		{
			const snapshot = server.snapshots[index];
			spinner.text = `Deleting ${format_date(snapshot.date)} snapshot for ${server.name}...`;
			await delete_snapshot(snapshot.id);
			await sleep(1000);
		}

		if(server.status !== 'inactive')
		{
			spinner.text = `Deleting ${server.name}...`;
			await delete_server(server);
		}

		spinner.stop();
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export function get_snapshot_details(server: Server, snapshot_id: number | string): {id: number | string, date: string, disk: number}
{
	let snapshot_details;
	for (let index = 0; index < server.snapshots.length; index++)
	{
		const snapshot = server.snapshots[index];
		if(snapshot.id === snapshot_id)
		{
			snapshot_details = snapshot;
		}
	}

	if(!snapshot_details)
	{
		throw new Error(`Server ${server.name} has no snapshot ${snapshot_id}`);
	}

	return {id: snapshot_details.id, date: snapshot_details.date, disk: snapshot_details.disk};
}

export async function load_available_ips(location: string): Promise<{ ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; }>
{
	const spinner = ora({text: 'Loading primary IPs', spinner: 'point', color: 'cyan'}).start();

	try
	{
		const ips = await get_primary_ips();
		const ipv4: PrimaryIP[] = [];
		const ipv6: PrimaryIP[] = [];

		for(const ip of ips)
		{
			if(ip.assigned || ip.location !== location)
			{
				continue;
			}

			if(ip.type === 'ipv4')
			{
				ipv4.push(ip);
				continue;
			}
			ipv6.push(ip);
		}

		spinner.stop();
		return {ipv4, ipv6};
	}
	catch(error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function delete_ip(ip: PrimaryIP)
{
	const spinner = ora({text: 'Deleting IP address...', spinner: 'point', color: 'red'}).start();
	try
	{
		await delete_primary_ip(ip.id);
		spinner.stop();
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function update_ip_retention_policy(server: Server, keep_ipv4: boolean, keep_ipv6: boolean)
{
	const spinner = ora({text: `Updating IP retention policy for ${server.name} ...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const server_info = await get_server(server.id);
		if(server_info.ips.ipv4)
		{
			await change_ip_auto_delete_status(server_info.ips.ipv4.id, !keep_ipv4);
		}

		if(server_info.ips.ipv6)
		{
			await change_ip_auto_delete_status(server_info.ips.ipv6.id, !keep_ipv6);
		}

		spinner.stop();
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export function read_config_for_server(server: Server)
{
	const server_config = read_server_config();
	if(!server_config)
	{
		return false;
	}

	for(const server_details of server_config.servers)
	{
		if(server_details.name === server.name)
		{
			return server_details;
		}
	}

	return false;
}

export function get_ip_id(ip: string, type: 'ipv4' | 'ipv6', available_ips: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; }): number | boolean
{
	for(const available_ip of available_ips[type])
	{
		if(available_ip.ip === ip)
		{
			return available_ip.id;
		}
	}

	return false;
}

export async function load_available_server_types(location: string, architecture?: 'x86' | 'arm'): Promise<ServerType[]>
{
	const spinner = ora({text: `Loading available server types...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const server_types = await get_available_server_types(location, architecture);
		server_types.sort(
			function(a, b)
			{
				if(!a.monthly_price)
				{
					return -1;
				}
				if(!b.monthly_price)
				{
					return 1;
				}

				return a.monthly_price - b.monthly_price;
			}
		);

		spinner.stop();
		return server_types;
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function determine_preselected_config(server?: Server, location?: string)
{
	if(!location)
	{
		if(server && server.location)
		{
			location = server.location;
		}
		else
		{
			location = 'fsn1';
		}
	}

	try
	{
		let type;
		let os_image;
		let ssh_keys: string[] = [];
		let ipv4;
		let ipv6;

		if(server)
		{
			const saved_server_config = read_config_for_server(server);
			if(saved_server_config)
			{
				if(saved_server_config.location)
				{
					location = saved_server_config.location;
				}
				if(saved_server_config.type)
				{
					type = saved_server_config.type;
				}
				if(saved_server_config.ssh_keys)
				{
					ssh_keys = saved_server_config.ssh_keys;
				}
				if(saved_server_config.ipv4)
				{
					ipv4 = saved_server_config.ipv4;
				}
				if(saved_server_config.ipv6)
				{
					ipv6 = saved_server_config.ipv6;
				}
			}
		}

		const hetzner_config = read_hetzner_config();
		if(hetzner_config)
		{
			if(!location && hetzner_config.preferred_location)
			{
				location = hetzner_config.preferred_location;
			}
			if(hetzner_config.preferred_os && !server)
			{
				os_image = hetzner_config.preferred_os;
			}
			if(ssh_keys.length === 0 && hetzner_config.ssh_keys)
			{
				ssh_keys = hetzner_config.ssh_keys;
			}
		}

		const available_ips = await load_available_ips(location);
		if(!ipv4 || !get_ip_id(ipv4, 'ipv4', available_ips))
		{
			ipv4 = undefined;
		}
		if(!ipv6 || !get_ip_id(ipv6, 'ipv6', available_ips))
		{
			ipv6 = undefined;
		}

		let architecture: 'x86' | 'arm' | undefined;
		if(server && server.snapshots.length > 0)
		{
			architecture = server.snapshots[0].architecture;
		}

		if(!server)
		{
			if(!os_image)
			{
				if(architecture === 'x86')
				{
					os_image = 161547269;
				}
				else if(architecture === 'arm')
				{
					os_image = 161547270;
				}
			}
			else
			{
				const spinner = ora({text: 'Loading OS image details...', spinner: 'point', color: 'cyan'}).start();
				
				const image_details = await get_snapshot(os_image);
				architecture = image_details.architecture;

				spinner.stop();
			}

			if(!architecture)
			{
				architecture = 'x86';
			}
		}

		const available_server_types = await load_available_server_types(location, architecture);

		if(!type)
		{
			if(available_server_types.length > 0)
			{
				type = available_server_types[0].name;
			}
			else
			{
				if(architecture === 'x86')
				{
					type = 'cx23';
				}
				else
				{
					type = 'cax11';
				}
			}
		}
		else
		{
			let still_available = false;
			for (const server_type of available_server_types)
			{
				if(server_type.name === type)
				{
					still_available = true;
				}
			}

			if(!still_available)
			{
				if(available_server_types.length > 0)
				{
					type = available_server_types[0].name;
				}
				else
				{
					if(architecture === 'x86')
					{
						type = 'cx23';
					}
					else
					{
						type = 'cax11';
					}
				}
			}
		}

		if(!ipv4)
		{
			ipv4 = 'new';
		}

		if(!ipv6)
		{
			ipv6 = 'new';
		}

		return { location, type, os_image, ssh_keys, ipv4, ipv6, available_ips, available_server_types };
	}
	catch (error)
	{
		throw new Error(error_to_string(error));
	}
}

export function create_config_for_server(server: Server, new_config?: NewServerConfig)
{
	let current_server_config = read_server_config();

	const empty_keys: string[] = [];
	if(current_server_config)
	{
		let server_in_config = false;
		for(const index in current_server_config.servers)
		{
			if(new_config)
			{
				if(current_server_config.servers[index].name === new_config.name)
				{
					current_server_config.servers[index].type = new_config.type;

					if(new_config.ipv4 !== 'new' && new_config.ipv4 !== 'none')
					{
						current_server_config.servers[index].ipv4 = new_config.ipv4;
					}
					if(new_config.ipv6 !== 'new' && new_config.ipv6 !== 'none')
					{
						current_server_config.servers[index].ipv6 = new_config.ipv6;
					}

					current_server_config.servers[index].location = new_config.location;
					current_server_config.servers[index].ssh_keys = new_config.ssh_keys;
					current_server_config.servers[index].last_update = Date.now();
					server_in_config = true;
				}
			}
			else
			{
				if(current_server_config.servers[index].name === server.name)
				{
					current_server_config.servers[index].type = server.type;
					current_server_config.servers[index].ipv4 = server.ipv4;
					current_server_config.servers[index].ipv6 = server.ipv6;
					current_server_config.servers[index].location = server.location;
					current_server_config.servers[index].last_update = Date.now();
					server_in_config = true;
				}
			}
		}

		if(!server_in_config)
		{
			const new_server = 
			{
				name: server.name,
				type: server.type,
				ipv4: server.ipv4,
				ipv6: server.ipv6,
				location: server.location,
				ssh_keys: empty_keys,
				last_update: Date.now()
			};

			if(new_config)
			{
				new_server.type = new_config.type;

				if(new_config.ipv4 !== 'new' && new_config.ipv6 !== 'none')
				{
					new_server.ipv4 = new_config.ipv4;
				}
				if(new_config.ipv6 !== 'new' && new_config.ipv6 !== 'none')
				{
					new_server.ipv6 = new_config.ipv6;
				}

				new_server.location = new_config.location;
				new_server.ssh_keys = new_config.ssh_keys;
			}

			current_server_config.servers.push(new_server);
		}
	}
	else
	{
		const new_server = 
		{ 
			name: server.name, 
			type: server.type, 
			ipv4: server.ipv4, 
			ipv6: server.ipv6, 
			location: server.location,
			ssh_keys: empty_keys,
			last_update: Date.now()
		};

			if(new_config)
			{
				new_server.type = new_config.type;

				if(new_config.ipv4 !== 'new' && new_config.ipv6 !== 'none')
				{
					new_server.ipv4 = new_config.ipv4;
				}
				if(new_config.ipv6 !== 'new' && new_config.ipv6 !== 'none')
				{
					new_server.ipv6 = new_config.ipv6;
				}

				new_server.location = new_config.location;
				new_server.ssh_keys = new_config.ssh_keys;
			}

		current_server_config = 
		{
			servers: [new_server]
		};
	}

	update_server_config(current_server_config);
}

export function update_config_for_server(server: Server, new_config: Partial<ServerConfig>)
{
	let current_server_config = read_server_config();
	if(!current_server_config)
	{
		create_config_for_server(server);
		current_server_config = read_server_config();
	}

	if(!current_server_config)
	{
		throw new Error('Failed to read config');
	}

	for (const server_in_config of current_server_config.servers)
	{
		if(server_in_config.name !== server.name)
		{
			continue;
		}

		Object.assign(server_in_config, new_config);
	}

	update_server_config(current_server_config);
}

export async function get_reverse_of_last_server_status_change(): Promise<{server: Server, reverse_action: "spin_up_last" | "save_stop"} | false>
{
	const server_config = read_server_config();
	if(!server_config)
	{
		return false;
	}

	let latest_server_interaction;
	let server_name;

	for(const server of server_config.servers)
	{
		if(!latest_server_interaction || latest_server_interaction < server.last_update)
		{
			latest_server_interaction = server.last_update;
			server_name = server.name;
		}
	}

	if(!server_name)
	{
		return false;
	}

	let reverse_action: 'save_stop' | 'spin_up_last' | false = false;
	let last_changed_server: Server | false = false;

	const spinner = ora({text: '', spinner: 'boxBounce'});
	spinner.text = 'Loading servers...';
	spinner.start();

	const server_list = await generate_server_list();

	spinner.stop();

	for (const [name, server] of server_list)
	{
		if(name !== server_name)
		{
			continue;
		}

		if(server.status !== 'inactive')
		{
			reverse_action = 'save_stop';
		}
		else
		{
			reverse_action = 'spin_up_last';
		}

		last_changed_server = server;
		break;
		
	}

	if(!last_changed_server || !reverse_action)
	{
		return false;
	}

	return {server: last_changed_server, reverse_action};
}

export async function get_available_os_images(max_disk_size?: number, architecture?: 'x86' | 'arm')
{
	const spinner = ora({text: `Loading available OS images...`, spinner: 'point', color: 'cyan'}).start();
	
	try
	{
		const os_images = await get_os_images();

		const raw_os_images: Map<string, OSImage[]> = new Map();
		const app_images: Map<string, OSImage[]> = new Map();

		for(const os_image of os_images)
		{
			if(max_disk_size && os_image.disk_size > max_disk_size)
			{
				continue;
			}
			if(architecture && os_image.architecture !== architecture)
			{
				continue;
			}

			if(os_image.type === 'app')
			{
				const app_by_name = app_images.get(os_image.name);
				if(app_by_name)
				{
					app_by_name.push(os_image);
				}
				else
				{
					app_images.set(os_image.name, [os_image]);
				}
			}
			else
			{
				const os_by_name = raw_os_images.get(os_image.os_flavor);
				if(os_by_name)
				{
					os_by_name.push(os_image);
				}
				else
				{
					raw_os_images.set(os_image.os_flavor, [os_image]);
				}
			}
		}

		for (const [os_name, os_versions] of raw_os_images)
		{
			os_versions.sort(
				function(a, b)
				{
					if(!a.os_version)
					{
						return 1;
					}
					if(!b.os_version)
					{
						return -1;
					}

					return parseFloat(b.os_version) - parseFloat(a.os_version);
				}
			);
		}

		spinner.stop();
		return {raw_os_images, app_images};

	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function create_new_server(
						name: string,
						type: string, 
						image: number,
						location: string,
						ssh_keys: string[], 
						ipv4: string,
						ipv6: string,
						available_ips?: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; })
{
	const ip_config = ip_config_to_hetzner_format(ipv4, ipv6, available_ips);

	const spinner = ora({text: `Initializing ${name}...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const new_server_details = await spin_up_server(image, name, type, location, ssh_keys, ip_config);

		return await spin_up_visual(new_server_details, spinner, ssh_keys, ipv4, ipv6);
	}
	catch (error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}