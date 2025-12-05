import readline from 'readline';
import { error_to_string } from './utils';
import select from '@inquirer/select';
import input from '@inquirer/input';
import { ServerList } from './types';

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

type SelectInquiryOptions = {name: string, value: string | number, description?: string}[];

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

export async function show_server_list(servers: ServerList)
{
	const server_select_list: SelectInquiryOptions = [];

	servers.forEach(function(server, server_name)
	{
		let active_server = 'inactive';
		if(server.type === 'server')
		{
			active_server = 'running';
		}

		server_select_list.push({name: server_name, value: server.id, description: active_server});
	});

	const selected_server = await get_select_response('Server list:', server_select_list);
	console.log(selected_server);
}