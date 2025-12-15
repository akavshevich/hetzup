import { clear_prompt, error_to_string, format_date, round_to_precision } from './utils';
import select from '@inquirer/select';
import input from '@inquirer/input';
import { Separator } from '@inquirer/prompts';
import { Server, ServerList } from './types';
import chalk from 'chalk';
import { read_hetzner_config, update_hetzner_config } from './configs';
import { call_hetzner_api, get_running_servers } from './api_calls';

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
		return 0;
	}
}

export async function select_server(servers: ServerList): Promise< Server | false>
{
	const server_select_list: SelectInquiryOptions = [];

	servers.forEach(
		function(server, server_name)
		{
			let display_server = chalk.green(server_name)+ ' Status: ' + server.status;

			if(['running', 'starting', 'migrating', 'rebuilding', 'off'].includes(server.status))
			{
				display_server += ' | Cores: ' + server.cores + ', Disk: ' + server.disk + 'GB, Mem: ' + server.memory + ' GB'
			}
			else
			{
				display_server += ' | Required disk space: ' + round_to_precision(server.disk, 2) + ' GB';
			}

			server_select_list.push({name: display_server, value: server_name});
		}
	);

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

	const selected_action =  await get_select_response(server.name + ':', server_actions_list);
	if(selected_action === 0)
	{
		return false;
	}

	return selected_action;
}

export async function show_snapshots(server: Server): Promise< number | string | false>
{
	const snapshots = server.snapshots.reverse();
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

export async function configure_api_key()
{
	let api_key = await get_text_response('Enter your Hetzner Cloud API key to begin: ');
	api_key = api_key.trim();

	try
	{
		update_hetzner_config({api_token: api_key});
	}
	catch(error)
	{
		throw new Error('Failed to save API key: ' + error_to_string(error));
	}
}

export async function configure()
{
	const hetzner_config = read_hetzner_config();
	
	if(!hetzner_config || !hetzner_config.api_token || hetzner_config.api_token === '')
	{
		await configure_api_key();
		const call_attempt = await call_hetzner_api('servers', 'GET');

		if(call_attempt.successful)
		{
			configure();
			return;
		}
		else if (call_attempt.error.includes('401'))
		{
			await show_error('Incorrect API key. Go back to try again.');
			
			try
			{
				update_hetzner_config({api_token: ''});
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

	const available_configs: SelectInquiryOptions =
	[
		{name: 'Change Hetzner Cloud API key', value: 'api_key'},
		{name: 'Preferred location: [fsn1]', value: 'pref_location'},
		{name: 'Default SSH keys: [a, b, c]', value: 'ssh_keys'},
		new Separator(),
		{name: 'Back', value: 0}
	];
}