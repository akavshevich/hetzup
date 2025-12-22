import ora from 'ora';

import { read_server_config, update_server_config } from './configs';
import { log_error, error_to_string, sleep, format_date } from "./utils";
import { get_running_servers, get_snapshots, get_available_server_types, initialize_snapshot_save, get_snapshot, delete_server, spin_up_server, get_server, delete_snapshot, rebuild_server_from_image, get_primary_ips, delete_primary_ip } from './api_calls';
import { NewServerDetails, PrimaryIP, Server, ServerList } from './types';
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
			updated_server_details.id = snapshot.id; // Hetzner sorts the snapshots from oldest to newest, that way the latest will be here
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