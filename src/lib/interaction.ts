import readline from 'readline';
import { error_to_string } from './utils';
import select from '@inquirer/select';
import input from '@inquirer/input';
import { Separator } from '@inquirer/prompts';
import { Server, ServerList } from './types';
import chalk from 'chalk';

export function welcome(): void
{
	get_text_response(
		'Welcome!\n' +
		'Say Hello! \n'
	)
	.then(
		function(response)
		{
			startup(response);
		}
	)
	.catch(
		function(error)
		{
			console.log('Error when trying to read initial command: ', error)
		}
	);
}

export async function get_text_response(prompt: string): Promise<string>
{
	try
	{
		const get_answer = await input({ message: prompt });
		return get_answer;
	}
	catch(error)
	{
		console.log('Error when trying to get text response: ', error_to_string(error));
		return '';
	}
}

type SelectInquiryOptions = ( {name: string, value: string | number, description?: string} | Separator)[];

export async function get_select_response(prompt: string, options: SelectInquiryOptions): Promise<string | number>
{
	const params = {'message': prompt, choices: options};
	
	try
	{
		const answer = await select(params);
		readline.moveCursor(process.stdout, 0, -1); // Move up 1 line
		readline.clearLine(process.stdout, 0); // Clear the line
		return answer;
	}
	catch (error)
	{
		console.log('Error when trying to get a choice selection: ', error_to_string(error));
		return 0;
	}
}

function startup(command: string): void{
	switch (command)
	{
		case "hello":
			console.log('Hello!');
			break;
		default:
			console.log('unknown command');
			break;
	}
}

export async function select_server(servers: ServerList): Promise< Server>
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
				display_server += ' | Required disk space: ' + Math.round(server.disk * 100) / 100 + ' GB';
			}

			server_select_list.push({name: display_server, value: server_name});
		}
	);

	try
	{
		const selected_server_name = await get_select_response('Choose server', server_select_list);
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

export async function show_server_actions(server: Server)
{
	const server_actions_list: SelectInquiryOptions = [];

	if(server.status === 'running')
	{
		server_actions_list.push({name: 'Save to snapshot and stop', value: 'save_stop'});
		server_actions_list.push({name: 'Save to snapshot without stopping', value: 'save'});
		server_actions_list.push({name: 'Revert to previous snapshot', value: 'revert'});
		server_actions_list.push({name: 'Stop without saving', value: 'stop'});
		server_actions_list.push(new Separator());
		server_actions_list.push({name: 'Back', value: 'back'});
	}
	else if(server.status === 'inactive')
	{
		server_actions_list.push({name: 'Spin up from last snapshot', value: 'spin_up_last'});
		server_actions_list.push({name: 'Select snapshot to spin up from', value: 'spin_up_select'});
		server_actions_list.push({name: 'Select snapshot(s) to delete', value: 'delete_snapshots'});
		server_actions_list.push(new Separator());
		server_actions_list.push({name: 'Back', value: 'back'});
	}
	else
	{
		console.log('No actions available as the server status is ' + server.status);
		return 'none';
	}

	return await get_select_response(server.name + ':', server_actions_list);
}