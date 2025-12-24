import ora from 'ora';

import { read_hetzner_config, read_server_config, update_server_config } from './configs';
import { log_error, error_to_string, sleep, format_date } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, get_snapshot, delete_server, spin_up_server, get_server, delete_snapshot, rebuild_server_from_image, get_primary_ips, delete_primary_ip, change_ip_auto_delete_status } from './api_calls';
import { NewServerDetails, PrimaryIP, Server, ServerList, ServerType } from './types';
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
					snapshots: [{id: snapshot.id, date: snapshot.date, disk: snapshot.disk}], disk: snapshot.disk}
			);
			continue;
		}

		const updated_server_details: Server = 
		{
			id: existing_server.id,
			name: existing_server.name,
			status: existing_server.status, 
			snapshots: [...existing_server.snapshots, {id: snapshot.id, date: snapshot.date, disk: snapshot.disk}],
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
			let current_server_config = read_server_config();
			
			if(current_server_config)
			{
				let server_in_config = false;
				for(const index in current_server_config.servers)
				{
					if(current_server_config.servers[index].name === server.name)
					{
						current_server_config.servers[index].type = server.type;
						current_server_config.servers[index].ipv4 = server.ipv4;
						current_server_config.servers[index].ipv6 = server.ipv6;
						current_server_config.servers[index].location = server.location;
						server_in_config = true;
					}
				}

				if(!server_in_config)
				{
					current_server_config.servers.push(
						{
							name: server.name, 
							type: server.type, 
							ipv4: server.ipv4, 
							ipv6: server.ipv6, 
							location: server.location
						}
					);
				}
			}
			else
			{
				current_server_config = 
				{
					servers: [{name: server.name, type: server.type, ipv4: server.ipv4, ipv6: server.ipv6, location: server.location}]
				};
			}

			update_server_config(current_server_config);

			await save_server_to_snapshot(server);
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

export async function spin_up_from_snapshot(server: Server, type: string, latest: boolean = true, snapshot_id?: string | number): Promise< Server >
{
	if(server.status !== 'inactive')
	{
		throw new Error(`${server.name} is already running`);
	}

	if(latest || !snapshot_id)
	{
		snapshot_id = server.id;
	}

	const spinner = ora({text: `Initializing ${server.name}...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const new_server_details = await spin_up_server(snapshot_id, server.name, type);

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
							spinner.text = `${capitalized_status} ${server.name}...`;
							return;
						}


						clearInterval(check_on_server);
						spinner.stop();

						if(new_server_details.root_password)
						{
							await show_info(`Root password for ${server.name}: ${chalk.cyan(new_server_details.root_password)} It will not be shown again!`);
						}

						resolve(server_details);
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

export async function load_available_server_types(location: string): Promise<ServerType[]>
{
	const spinner = ora({text: `Loading available server types...`, spinner: 'point', color: 'cyan'}).start();
	try
	{
		const server_types = await get_available_server_types(location);
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

		if(!type)
		{
			const available_server_types = await load_available_server_types(location);
			if(available_server_types.length > 0)
			{
				type = available_server_types[0].name;
			}
			else
			{
				type = 'cx23';
			}
		}

		return { location, type, ssh_keys, ipv4, ipv6 };
	}
	catch (error)
	{
		throw new Error(error_to_string(error));
	}
}