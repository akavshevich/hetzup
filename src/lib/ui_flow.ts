import ora from "ora";

import { configure_api_key, select_ssh_keys, configure_ip_retention, select_location, confirm_dangerous, decide_to_keep_ips, select_server, show_config, show_error, show_main_menu, show_server_actions, show_snapshots, new_server_confirmation, select_os, choose_server_name, configure_ports } from "./interaction";
import { complete_server_removal, create_new_server, delete_snapshot_visual, determine_preselected_config, generate_server_list, get_snapshot_details, revert_to_snapshot, save_server_to_snapshot, spin_up_from_snapshot, stop_server, update_ip_retention_policy } from "./server_actions";
import { Server } from "./types";
import { error_to_string, format_date } from "./utils";
import { disable_server_config, enable_nginx_config, read_hetzner_config, update_hetzup_config } from "./configs";
import { call_hetzner_api } from "./api_calls";

export async function main(navigate_to?: string)
{
	const hetzner_config = read_hetzner_config();
	if(!hetzner_config || hetzner_config.api_token === '')
	{
		await configure();
		return;
	}

	const spinner = ora({text: '', spinner: 'boxBounce'});

	try
	{
		let main_menu_response: string | number | undefined = navigate_to;
		if(!navigate_to)
		{
			main_menu_response = await show_main_menu();
		}

		switch (main_menu_response)
		{
			case 'reverse_action':
				return;

			case 'servers':
				spinner.text = 'Loading servers...';
				spinner.start();
				const server_list = await generate_server_list();
				spinner.stop();

				const selected_server = await select_server(server_list);

				if(!selected_server)
				{
					main();
					break;
				}

				server_actions(selected_server);
				break;

			case 'new_server':
				const server_name = await choose_server_name();

				if(!server_name)
				{
					main();
					break;
				}

				const preselected_config = await determine_preselected_config();
				const confirmed_config = await new_server_confirmation(
					preselected_config, 
					preselected_config.available_ips, 
					preselected_config.available_server_types
				);

				if(!confirmed_config || !confirmed_config.os_image)
				{
					main();
					break;
				}

				const new_server = await create_new_server(
					server_name, 
					confirmed_config.type, 
					confirmed_config.os_image,
					confirmed_config.location, 
					confirmed_config.ssh_keys,
					confirmed_config.ipv4,
					confirmed_config.ipv6,
					preselected_config.available_ips
				);

				await configure_ports(new_server);

				main('servers');
				break;

			case 'configure':
				configure();
				break;

			case 'exit':
				process.exit();

			default:
				throw new Error('Unknown main menu option');
		}
	}
	catch(error)
	{
		spinner.stop();
		await show_error(error);
		main();
	}
}

export async function server_actions(server: Server, action: string | number | false = false)
{
	try
	{
		if(!action)
		{
			action = await show_server_actions(server); 
		}

		if(!action)
		{
			main('servers');
			return;
		}

		switch (action)
		{
			case 'stop':
			case 'save_stop':
				let critical = false;

				if(action === 'stop')
				{
					let warning = `Are you sure you want to stop ${server.name} without saving changes?`;

					if(server.snapshots.length === 0)
					{
						warning = `${server.name} has no snapshots! This will remove it completely! Are you sure?`;
						critical = true;
					}

					const confirm_stop = await confirm_dangerous(warning, critical);
					if(!confirm_stop)
					{
						main('servers');
						return;
					}
				}

				const ip_retention_decision = await decide_to_keep_ips(server);
				await update_ip_retention_policy(server, ip_retention_decision.ipv4, ip_retention_decision.ipv6);
				await stop_server(server, action);
				await disable_server_config(server.name, critical);

				main();
				return;

			case 'save':

				await save_server_to_snapshot(server);
				main('servers');
				return;

			case 'spin_up_last':

				const preselected_config = await determine_preselected_config(server);
				const confirmed_config = await new_server_confirmation(
					preselected_config, 
					preselected_config.available_ips, 
					preselected_config.available_server_types);

				if(!confirmed_config)
				{
					server_actions(server);
					return;
				}

				await spin_up_from_snapshot(
					server, 
					confirmed_config.type, 
					confirmed_config.location, 
					confirmed_config.ssh_keys,
					confirmed_config.ipv4,
					confirmed_config.ipv6,
					preselected_config.available_ips
				);
					
				main();
				return;

			case 'spin_up_select':
			case 'revert':
			case 'delete_snapshots':

				const snapshot_id = await show_snapshots(server);
				if(!snapshot_id)
				{
					server_actions(server);
					return;
				}

				const snapshot_details = get_snapshot_details(server, snapshot_id);

				if(action === 'spin_up_select')
				{
					const preselected_config = await determine_preselected_config(server);
					const confirmed_config = await new_server_confirmation(
						preselected_config, 
						preselected_config.available_ips, 
						preselected_config.available_server_types);

					if(!confirmed_config)
					{
						server_actions(server);
						return;
					}

					await spin_up_from_snapshot(
						server, 
						confirmed_config.type, 
						confirmed_config.location, 
						confirmed_config.ssh_keys,
						confirmed_config.ipv4,
						confirmed_config.ipv6,
						preselected_config.available_ips, 
						false, 
						snapshot_id
					);
				}
				else if(action === 'revert')
				{
					const confirm_revert = await confirm_dangerous(
						`Are you sure you want to revert ${server.name} to snapshot from ${format_date(snapshot_details.date)}?`);
					if(!confirm_revert)
					{
						server_actions(server);
						return;
					}

					await revert_to_snapshot(server, snapshot_id);
				}
				else if(action === 'delete_snapshots')
				{
					let backup_domain_config = false;
					let confirm_delete_snapshot;
					if(server.snapshots.length === 1 && server.status === 'inactive')
					{
						backup_domain_config = true;
						confirm_delete_snapshot = await confirm_dangerous(
						`${server.name} is not running and has no other snapshots! This will remove ${server.name} completely! Are you sure?`, true);
					}
					else
					{
						confirm_delete_snapshot = await confirm_dangerous(
						`Are you sure you want to delete ${format_date(snapshot_details.date)} snapshot for ${server.name}?`);
					}

					if(!confirm_delete_snapshot)
					{
						server_actions(server);
						return;
					}

					await delete_snapshot_visual(snapshot_id);
					await disable_server_config(server.name, backup_domain_config);

					server.snapshots = server.snapshots.filter(
						function (snapshot)
						{
							if(snapshot.id === snapshot_id)
							{
								return false;
							}
							return true;
						}
					);

					server_actions(server, 'delete_snapshots');
					return;
				}

				main('servers');
				return;

			case 'configure_ports':
				await configure_ports(server);
				await enable_nginx_config(server);
				main('servers');
				return;

			case 'delete_completely':

				const confirm_delete_completely = await confirm_dangerous(
					`Are you sure you want to completely delete ${server.name} and all its snapshots?`, true);
				if(confirm_delete_completely)
				{
					if(server.status !== 'inactive')
					{
						const ip_retention_decision = await decide_to_keep_ips(server);
						await update_ip_retention_policy(server, ip_retention_decision.ipv4, ip_retention_decision.ipv6);
					}

					await complete_server_removal(server);
					await disable_server_config(server.name, true);
				}
				main('servers');
				return;

			default:
				throw new Error(action + ' not implemented');
		}
	}
	catch(error)
	{
		await show_error(error);
		server_actions(server);
	}
}

export async function configure()
{
	try
	{
		const hetzner_config = read_hetzner_config();
		
		if(!hetzner_config || !hetzner_config.api_token || hetzner_config.api_token === '')
		{
			await configure_api_key();
			const call_attempt = await call_hetzner_api('servers', 'GET');

			if(call_attempt.successful)
			{
				await configure();
				return;
			}
			else if (call_attempt.error.includes('401'))
			{
				await show_error('Incorrect API key. Go back to try again.');

				try
				{
					update_hetzup_config({api_token: ''});
					return;
				}
				catch(error)
				{
					throw new Error('Failed to reset API key: ' + error_to_string(error));
				}
			}
			else
			{
				throw new Error('Hetzner API is unreachable at the moment.');
			}
		}

		const chosen_config = await show_config();
		if(!chosen_config)
		{
			main();
			return;
		}

		switch (chosen_config)
		{
			case 'api_key':
				await configure_api_key();
				configure();
				break;
			
			case 'pref_location':
				await select_location(true);
				configure();
				break;

			case 'pref_os':
				await select_os(undefined, true);
				configure();
				break;

			case 'ssh_keys':
				let current_default_keys: string[] = [];
				if(hetzner_config.ssh_keys)
				{
					current_default_keys = hetzner_config.ssh_keys;
				}

				await select_ssh_keys(current_default_keys, true);
				configure();
				break;
			case 'keep_ipv4':
			case 'keep_ipv6':
				let retention_config_type: 'ipv4' | 'ipv6' = 'ipv4';
				if(chosen_config === 'keep_ipv6')
				{
					retention_config_type = 'ipv6';
				}

				await configure_ip_retention(retention_config_type);
				configure();
				break;
			default:
				throw new Error('Not implemented');
				break;
		}
	}
	catch(error)
	{
		await show_error(error);
		configure();
	}
}