import { clear_prompt, error_to_string, format_date, round_to_precision } from './utils';
import select from '@inquirer/select';
import input from '@inquirer/input';
import { checkbox, Separator } from '@inquirer/prompts';
import { NewServerConfig, PrimaryIP, Server, ServerList, ServerType } from './types';
import chalk from 'chalk';
import { read_hetzner_config, update_hetzner_config } from './configs';
import { call_hetzner_api, get_locations, get_running_servers, get_ssh_keys } from './api_calls';
import ora from 'ora';

export async function get_text_response(prompt: string): Promise<string>
{
	try
	{
		const get_answer = await input({ message: prompt, theme: {prefix: ''} });
		clear_prompt();
		return get_answer;
	}
	catch(error)
	{
		throw new Error('Error when trying to get text response: ' + error_to_string(error));
	}
}

type SelectInquiryOptions = ( {name: string, value: string | number, description?: string, disabled?: boolean} | Separator)[];

export async function get_select_response(prompt: string, options: SelectInquiryOptions): Promise<string | number>
{
	const params = {message: prompt, choices: options, loop: false, pageSize: 9, theme: {prefix: ''}};
	
	try
	{
		const answer = await select(params);
		clear_prompt();
		return answer;
	}
	catch (error)
	{
		throw new Error('Error when trying to get a choice selection: ' + error_to_string(error));
	}
}

export async function get_multi_choice_response(prompt: string, options: SelectInquiryOptions): Promise<(string | number)[]>
{
	const params = 
	{
		message: prompt + ' (Use SPACE to select, ENTER to confirm choices.)', 
		choices: options, 
		loop: false, 
		pageSize: 9, 
		theme: {prefix: ''}, 
		shortcuts: {all: null, invert: null}
	};

	try
	{
		const answers = await checkbox(params);
		clear_prompt();
		return answers;
	}
	catch (error)
	{
		throw new Error('Error when trying to get a multi choice response: ' + error_to_string(error));
	}
}

export async function select_server(servers: ServerList): Promise< Server | false>
{
	const server_select_list: SelectInquiryOptions = [];

	servers.forEach(
		function(server, server_name)
		{
			let server_name_color = chalk.green(server_name);
			let display_server = ' Status: ' + server.status;

			if(['running', 'starting', 'migrating', 'rebuilding', 'off'].includes(server.status))
			{
				display_server += ' | Cores: ' + server.cores + ', Disk: ' + server.disk + 'GB, Mem: ' + server.memory + ' GB'
			}
			else
			{
				server_name_color = chalk.yellow(server_name);
				display_server += ' | Required disk space: ' + round_to_precision(server.disk, 2) + ' GB';
			}

			server_select_list.push({name: server_name_color + display_server, value: server_name});
		}
	);

	if(server_select_list.length === 0)
	{
		server_select_list.push({name: 'You have no servers', value: 0, disabled: true});
	}

	server_select_list.push(new Separator());
	server_select_list.push({name: 'Back', value: 0});

	try
	{
		const selected_server_name = await get_select_response('Choose server', server_select_list);

		if(selected_server_name === 0)
		{
			return false;
		}

		const selected_server = servers.get(selected_server_name);

		if(selected_server)
		{
			return selected_server;
		}
		else
		{
			throw new Error('Server not found');
		}
	}
	catch(error)
	{
		throw new Error(error_to_string(error));
	}
}

export async function show_server_actions(server: Server): Promise<string | number | false>
{
	const server_actions_list: SelectInquiryOptions = [];

	if(server.status === 'running')
	{
		server_actions_list.push({name: 'Save to snapshot and stop', value: 'save_stop'});
		server_actions_list.push({name: 'Save to snapshot without stopping', value: 'save'});

		if(server.snapshots.length > 0)
		{
			server_actions_list.push({name: 'Revert to previous snapshot', value: 'revert'});
		}
		
		server_actions_list.push({name: 'Stop without saving', value: 'stop'});
	}
	else if(server.status === 'inactive')
	{
		server_actions_list.push({name: 'Spin up from last snapshot', value: 'spin_up_last'});
		server_actions_list.push({name: 'Select snapshot to spin up from', value: 'spin_up_select'});
	}
	else
	{
		throw new Error('No actions available as the server status is ' + server.status);
	}

	server_actions_list.push({name: 'Select snapshot(s) to delete', value: 'delete_snapshots'});
	server_actions_list.push({name: chalk.red('Delete completely'), value: 'delete_completely'});
	server_actions_list.push(new Separator());
	server_actions_list.push({name: 'Back', value: 0});

	const selected_action = await get_select_response(server.name + ':', server_actions_list);
	if(selected_action === 0)
	{
		return false;
	}

	return selected_action;
}

export async function show_snapshots(server: Server): Promise< number | string | false>
{
	const snapshots = [...server.snapshots].reverse();
	const snapshot_list: SelectInquiryOptions = [];

	for (let index = 0; index < snapshots.length; index++)
	{
		const snapshot = snapshots[index];
		snapshot_list.push({name: `${format_date(snapshot.date)} | ${round_to_precision(snapshot.disk, 2)} GB`, value: snapshot.id});
	}

	if(snapshot_list.length === 0)
	{
		snapshot_list.push({name: 'No snapshots available', value: 0, disabled: true});
	}

	snapshot_list.push(new Separator());
	snapshot_list.push({name: 'Back', value: 0});

	const selected_snapshot = await get_select_response(`Snapshots for ${server.name}:`, snapshot_list);

	if(selected_snapshot === 0)
	{
		return false;
	}

	return selected_snapshot;
}

export async function show_main_menu(): Promise< string | number >
{
	const main_menu: SelectInquiryOptions = 
	[
		{name: 'My Servers', value: 'servers'},
		{name: 'New Server', value: 'new_server'},
		{name: 'Configure', value: 'configure'},
		new Separator(),
		{name: 'Exit', value: 'exit'}
	];

	return await get_select_response('Welcome to Hetzner Server Manager!', main_menu);
}

export async function confirm_dangerous(message: string, critical: boolean = false): Promise<boolean>
{
	if(critical)
	{
		const response = await get_text_response(chalk.red(message) + " Type 'yes' to confirm.");

		if(response === 'yes')
		{
			return true;
		}
		return false;
	}

	const response = await get_select_response(chalk.red(message), [{name: 'Yes', value: 1}, {name: 'No', value: 0}]);
	if(response)
	{
		return true;
	}
	return false;
}

export async function show_error(error: any)
{
	const exit_program = await get_select_response(chalk.red('Error: ' + error_to_string(error)), 
		[
			new Separator(),
			{name: 'Back', value: 0}, 
			{name: 'Exit', value: 1}
		]
	);
	if(exit_program)
	{
		process.exit();
	}

	return;
}

export async function show_info(message: string)
{
	await get_select_response(message, 
		[
			new Separator(),
			{name: 'OK', value: 1}
		]
	);

	return;
}

export async function configure_api_key()
{
	let api_key = await get_text_response('Enter your Hetzner Cloud API key: ');
	api_key = api_key.trim();

	if(api_key.length === 0)
	{
		return;
	}

	if(api_key.length !== 64)
	{
		throw new Error(`API key must be 64 characters long, this one is ${api_key.length}`);
	}

	try
	{
		update_hetzner_config({api_token: api_key});
	}
	catch(error)
	{
		throw new Error('Failed to save API key: ' + error_to_string(error));
	}
}

export async function select_location(save_preferred?: boolean)
{
	const spinner = ora({text: 'Loading available server locations...', spinner: 'boxBounce', color: 'cyan'}).start();
	
	let prompt = 'Select server location';
	if(save_preferred)
	{
		prompt = 'Select preferred server location';
	}

	try
	{
		const locations = await get_locations();
		spinner.stop();
		
		const location_options: SelectInquiryOptions = [];
		for(const location of locations)
		{
			location_options.push({name: `${location.description} (${location.location})`, value: location.location});
		}
		location_options.push(new Separator());
		location_options.push({name: 'Back', value: 0});

		const selected_location = await get_select_response(prompt, location_options);

		if(typeof selected_location !== 'string')
		{
			return;
		}

		if(save_preferred)
		{
			update_hetzner_config({preferred_location: selected_location});
		}

		return selected_location;
	}
	catch(error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

type MultiChoiceInquiryOptions = SelectInquiryOptions & {checked?: boolean};

export async function select_ssh_keys(current_keys: string[], save_default?: boolean)
{
	const spinner = ora({text: 'Loading your SSH keys ...', spinner: 'boxBounce', color: 'cyan'}).start();

	let prompt = 'Select SSH keys';
	if(save_default)
	{
		prompt = 'Select default SSH keys';
	}

	try
	{
		const ssh_keys = await get_ssh_keys();
		spinner.stop();
		
		const ssh_key_options: MultiChoiceInquiryOptions = [];
		for(const ssh_key of ssh_keys)
		{
			const ssh_key_option: {name: string, value: string | number, checked?: boolean} = {name: ssh_key, value: ssh_key};
			if(current_keys.includes(ssh_key))
			{
				ssh_key_option.checked = true;
			}

			ssh_key_options.push(ssh_key_option);
		}
		ssh_key_options.push(new Separator());
		ssh_key_options.push({name: 'None', value: 0});

		const selected_keys = await get_multi_choice_response(prompt, ssh_key_options);
		let key_names: string[] = [];
		for(const ssh_key of selected_keys)
		{
			if(typeof ssh_key !== 'string')
			{
				key_names = [];
				break;
			}
			key_names.push(ssh_key);
		}

		if(save_default)
		{
			update_hetzner_config({ssh_keys: key_names});
		}

		return key_names;
	}
	catch(error)
	{
		spinner.stop();
		throw new Error(error_to_string(error));
	}
}

export async function configure_ip_retention(type: 'ipv4' | 'ipv6')
{
	let display_ip_type = 'IPv4';	

	if(type === 'ipv6')
	{
		display_ip_type = 'IPv6';
	}

	const retention_options: SelectInquiryOptions = 
	[
		{name: 'Yes', value: 'yes'},
		{name: 'No', value: 'no'},
		{name: 'Ask me', value: 'ask'},
		new Separator(),
		{name: 'Back', value: 0}
	];

	try
	{
		const selected_retention_behavior = await get_select_response(`Keep ${display_ip_type} when stopping a server`, retention_options);

		if(selected_retention_behavior === 'yes' || selected_retention_behavior === 'no' || selected_retention_behavior === 'ask')
		{
			if(type === 'ipv4')
			{
				update_hetzner_config({keep_ipv4: selected_retention_behavior});
				return;
			}
			update_hetzner_config({keep_ipv6: selected_retention_behavior});
		}
	}
	catch (error)
	{
		throw new Error(error_to_string(error));
	}
}

export async function show_config(): Promise<string | number | false>
{
	const hetzner_config = read_hetzner_config();

	let pref_location = 'fsn1';
	let ssh_keys: string[] = [];
	let keep_ipv4 = 'ask';
	let keep_ipv6 = 'ask';

	if(hetzner_config && hetzner_config.preferred_location)
	{
		pref_location = hetzner_config.preferred_location;
	}

	if(hetzner_config && hetzner_config.ssh_keys)
	{
		ssh_keys = hetzner_config.ssh_keys;
	}

	if(hetzner_config)
	{
		keep_ipv4 = hetzner_config.keep_ipv4;
		keep_ipv6 = hetzner_config.keep_ipv6;
	}

	const available_configs: SelectInquiryOptions =
	[
		{name: 'Change Hetzner Cloud API key', value: 'api_key'},
		{name: `Preferred location: [${chalk.green(pref_location)}]`, value: 'pref_location'},
		{name: `Default SSH keys: [${chalk.green(ssh_keys.join(', '))}]`, value: 'ssh_keys'},
		{name: `Keep IPv4 when stopping a server (at cost): [${chalk.green(keep_ipv4)}]`, value: 'keep_ipv4'},
		{name: `Keep IPv6 when stopping a server (free): [${chalk.green(keep_ipv6)}]`, value: 'keep_ipv6'},
		new Separator(),
		{name: 'Back', value: 0}
	];

	const chosen_config = await get_select_response('Config', available_configs);
	if(!chosen_config)
	{
		return false;
	}

	return chosen_config;
}

export async function select_ips(available_ips: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; }, ipv4: string = 'none', ipv6: string = 'none'): 
																										Promise<{ ipv4: string; ipv6: string; }>
{
	let ipv4_selected = 'none';
	let ipv4_display = 'Don\'t assign'; 

	if(ipv4 === 'new')
	{
		ipv4_selected = 'new';
		ipv4_display = chalk.green('Assign new IP');
	}

	const ipv4_options: SelectInquiryOptions = [];
	for(let ip of available_ips.ipv4)
	{
		if(ip.ip === ipv4)
		{
			ipv4_selected = ip.ip;
			ipv4_display = `${ip.name} [${chalk.green(ip.ip)}]`;
		}

		ipv4_options.push({name: `${ip.ip} (${ip.name})`, value: ip.ip});
	}
	ipv4_options.push({name: 'Assign new IP', value: 'new'});
	ipv4_options.push({name: 'Don\'t assign IPv4', value: 'none'});
	ipv4_options.push(new Separator());
	ipv4_options.push({name: 'Back', value: 0});

	let ipv6_selected = 'none';
	let ipv6_display = 'Don\'t assign'; 

	if(ipv6 === 'new')
	{
		ipv6_selected = 'new';
		ipv6_display = chalk.green('Assign new IP');
	}

	const ipv6_options: SelectInquiryOptions = [];
	for(let ip of available_ips.ipv6)
	{
		if(ip.ip === ipv6)
		{
			ipv6_selected = ip.ip;
			ipv6_display = `${ip.name} [${chalk.green(ip.ip)}]`;
		}

		ipv6_options.push({name: `${ip.ip} (${ip.name})`, value: ip.ip});
	}
	ipv6_options.push({name: 'Assign new IP', value: 'new'});
	ipv6_options.push({name: 'Don\'t assign IPv6', value: 'none'});
	ipv6_options.push(new Separator());
	ipv6_options.push({name: 'Back', value: 0});

	const select_ip_type: SelectInquiryOptions = 
	[
		{name: `IPv4: ${ipv4_display}`, value: 'ipv4'},
		{name: `IPv6: ${ipv6_display}`, value: 'ipv6'},
		new Separator(),
		{name: 'Confirm', value: 0}
	];

	const ip_type_selected = await get_select_response('IPs to assign', select_ip_type);
	if(!ip_type_selected)
	{
		if(ipv4_selected === 'none' && ipv6_selected === 'none')
		{
			throw new Error('Server has neither IPv4 or IPv6 assigned');
		}
		return { ipv4: ipv4_selected, ipv6: ipv6_selected };
	}

	let ip_options = ipv4_options;
	let selection_prompt = 'IPv4:';

	if(ip_type_selected === 'ipv6')
	{
		ip_options = ipv6_options;
		selection_prompt = 'IPv6:';
	}

	const new_ip_choice = await get_select_response(selection_prompt, ip_options);
	if(typeof new_ip_choice === 'string')
	{
		if(ip_type_selected === 'ipv4')
		{
			ipv4_selected = new_ip_choice;
		}
		else
		{
			ipv6_selected = new_ip_choice;
		}
	}

	return await select_ips(available_ips, ipv4_selected, ipv6_selected);
}

export async function decide_to_keep_ips(server: Server): Promise<{ ipv4: boolean; ipv6: boolean; }>
{
	let keep_ipv4 = true;
	let keep_ipv6 = true;

	const hetzner_config = read_hetzner_config();
	if(server.ipv4 && hetzner_config)
	{
		if(hetzner_config.keep_ipv4 === 'no')
		{
			keep_ipv4 = false;
		}

		if(hetzner_config.keep_ipv4 === 'ask')
		{
			const ipv4_decision = await get_select_response(
				`Keep IPv4? ${chalk.yellow(server.ipv4)}`, 
				[{name: 'Keep', value: 'keep'}, {name: 'Discard', value: 'discard'}]
			);

			if(ipv4_decision === 'discard')
			{
				keep_ipv4 = false;
			}
		}
	}

	if(server.ipv6 && hetzner_config)
	{
		if(hetzner_config.keep_ipv6 === 'no')
		{
			keep_ipv6 = false;
		}

		if(hetzner_config.keep_ipv6 === 'ask')
		{
			const ipv6_decision = await get_select_response(
				`Keep IPv6? ${chalk.yellow(server.ipv6)}`, 
				[{name: 'Keep', value: 'keep'}, {name: 'Discard', value: 'discard'}]
			);

			if(ipv6_decision === 'discard')
			{
				keep_ipv6 = false;
			}
		}
	}

	return {ipv4: keep_ipv4, ipv6: keep_ipv6};
}

export async function select_server_type(server_types: ServerType[])
{
	const server_options: SelectInquiryOptions = [];
	for(const server_type of server_types)
	{
		let architecture = chalk.blue(server_type.architecture);
		if(server_type.architecture === 'arm')
		{
			architecture = chalk.red(server_type.architecture);
		}

		server_options.push(
			{
				name: `[${chalk.green(server_type.name)}]: ${architecture} ${server_type.cores} Cores ${server_type.memory}GB ${server_type.disk}GB ${round_to_precision(server_type.monthly_price, 2)}/month`, 
				value: server_type.name
			}
		);
	}

	server_options.push(new Separator());
	server_options.push({name: 'Back', value: 0});

	const selected_server_type = await get_select_response('Select server type', server_options);
	if(typeof selected_server_type !== 'string')
	{
		return false;
	}
	
	return selected_server_type;
}

export async function new_server_confirmation(
						new_server_config: Omit<NewServerConfig, 'name'>, 
						available_ips: { ipv4: PrimaryIP[]; ipv6: PrimaryIP[]; },
						available_server_types: ServerType[])
{
	let ipv4 = 'new';
	let ipv4_display = 'assign new';

	let ipv6 = 'new';
	let ipv6_display = 'assign new';

	if(new_server_config.ipv4)
	{
		if(new_server_config.ipv4 === 'none')
		{
			ipv4 = 'none';
			ipv4_display = 'none';
		}
		else
		{
			ipv4 = new_server_config.ipv4;
			ipv4_display = new_server_config.ipv4;
		}
	}

	if(new_server_config.ipv6)
	{
		if(new_server_config.ipv6 === 'none')
		{
			ipv6 = 'none';
			ipv6_display = 'none';
		}
		else
		{
			ipv6 = new_server_config.ipv6;
			ipv6_display = new_server_config.ipv6;
		}
	}

	const available_changes: SelectInquiryOptions =
	[
		{name: 'Confirm', value: 'no_changes'},
		new Separator(),
		{name: `Location: [${chalk.green(new_server_config.location)}]`, value: 'location'},
		{name: `Type: [${chalk.green(new_server_config.type)}]`, value: 'type'},
		{name: `SSH keys: [${chalk.green(new_server_config.ssh_keys.join(', '))}]`, value: 'ssh_keys'},
		{name: `IPv4: [${chalk.green(ipv4_display)}] IPv6: [${chalk.green(ipv6_display)}]`, value: 'ip'},
		new Separator(),
		{name: 'Cancel', value: 0}
	];

	const change_selected = await get_select_response('Config', available_changes);
	if(!change_selected)
	{
		return false;
	}
	else
	{
		switch (change_selected)
		{
			case 'no_changes':
				return new_server_config;
			case 'location':
				const new_location = await select_location();
				if(new_location)
				{
					new_server_config.location = new_location;
				}
				return await new_server_confirmation(new_server_config, available_ips, available_server_types);

			case 'type':
				const new_type = await select_server_type(available_server_types);
				if(new_type)
				{
					new_server_config.type = new_type;
				}
				return await new_server_confirmation(new_server_config, available_ips, available_server_types);

			case 'ssh_keys':
				const ssh_keys = await select_ssh_keys(new_server_config.ssh_keys);
				new_server_config.ssh_keys = ssh_keys;
				return await new_server_confirmation(new_server_config, available_ips, available_server_types);

			case 'ip':
				const selected_ips = await select_ips(available_ips, ipv4, ipv6);
				new_server_config.ipv4 = selected_ips.ipv4;
				new_server_config.ipv6 = selected_ips.ipv6;
				return await new_server_confirmation(new_server_config, available_ips, available_server_types);

			default:
				throw new Error('Unknown server config selection');
		}
	}
}