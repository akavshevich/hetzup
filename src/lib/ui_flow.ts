import ora from "ora";
import { confirm_dangerous, select_server, show_main_menu, show_server_actions } from "./interaction";
import { generate_server_list } from "./server_actions";
import { Server } from "./types";
import { sleep } from "./utils";

export async function main(navigate_to?: string)
{
	let main_menu_response: string | number | undefined = navigate_to;
	if(!navigate_to)
	{
		main_menu_response = await show_main_menu();
	}

	switch (main_menu_response)
	{
		case 'servers':
			const spinner = ora({text: 'Loading servers...', spinner: 'boxBounce'}).start();
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

		case 'exit':
			process.exit();

		default:
			console.log('Unknown main menu option');
			break;
	}
}

export async function server_actions(server: Server)
{
	const action = await show_server_actions(server); 

	if(!action)
	{
		main('servers');
		return;
	}

	switch (action)
	{
		case 'stop':

			const confirm_stop = await confirm_dangerous(`Are you sure you want to stop ${server.name} without saving changes?`);
			if(confirm_stop)
			{
				console.log(action, 'not implemented');
			}
			break;
		case 'delete_completely':

			const confirm_delete_completely = await confirm_dangerous(
				`Are you sure you want to completely delete ${server.name} and all its snapshots?`, true);
			if(confirm_delete_completely)
			{
				console.log(action, 'not implemented');
			}
			break;

		default:
			console.log(action, 'not implemented');
			break;
	}
}