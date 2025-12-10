import ora from "ora";
import { confirm_dangerous, select_server, show_error, show_main_menu, show_server_actions, show_snapshots } from "./interaction";
import { complete_server_removal, delete_snapshot_visual, generate_server_list, get_snapshot_details, revert_to_snapshot, save_server_to_snapshot, spin_up_from_snapshot, stop_server } from "./server_actions";
import { Server } from "./types";
import { format_date, sleep } from "./utils";

export async function main(navigate_to?: string)
{
	try
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
	catch(error)
	{
		await show_error(error);
		main();
	}
}

export async function server_actions(server: Server)
{
	try
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
			case 'save_stop':

				if(action === 'stop')
				{
					let warning = `Are you sure you want to stop ${server.name} without saving changes?`;
					let critical = false;

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

				await stop_server(server, action);
				main('servers');
				return;

			case 'save':

				await save_server_to_snapshot(server);
				main('servers');
				return;

			case 'spin_up_last':

				await spin_up_from_snapshot(server, 'cpx11');
				main('servers');
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
					await spin_up_from_snapshot(server, 'cpx11', false, snapshot_id);
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
					const confirm_delete_snapshot = await confirm_dangerous(
						`Are you sure you want to delete ${format_date(snapshot_details.date)} snapshot for ${server.name}?`);
					if(!confirm_delete_snapshot)
					{
						server_actions(server);
						return;
					}

					await delete_snapshot_visual(snapshot_id);
				}

				main('servers');
				return;

			case 'delete_completely':

				const confirm_delete_completely = await confirm_dangerous(
					`Are you sure you want to completely delete ${server.name} and all its snapshots?`, true);
				if(confirm_delete_completely)
				{
					await complete_server_removal(server);
				}
				main('servers');
				return;

			default:
				console.log(action, 'not implemented');
				main('servers');
				return;
		}
	}
	catch(error)
	{
		await show_error(error);
		server_actions(server);
	}
}