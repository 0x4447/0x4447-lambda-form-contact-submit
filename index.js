let aws = require('aws-sdk');
let validate = require("validate.js");

//
//	Create a Lambda object for invocation
//
let lambda = new aws.Lambda({
	region: process.env.AWS_REGION
});

//
//	Create a Secrets Manager client
//
let secrets_manager = new aws.SecretsManager({
	endpoint: "https://secretsmanager." + process.env.AWS_REGION + ".amazonaws.com",
	region: process.env.AWS_REGION
});

//
//	This function is responsabile for parsing and send the support email
//
exports.handler = async (event) => {

	//
	//	1.	Convert the body in to a JS object
	//
	let body = JSON.parse(event.body);

	//
	//	2.	Create a container that will be passed around the chain
	//
	let container = {
		request: body,
		email: {},
		response: {}
	};

	//
	//	->	Start the chain
	//
	try
	{
		container = await request_validation(container);
		container = await get_secrets(container);
		container = await check_re_captcha(container);
		container = await create_the_email(container);
		container = await send_the_email(container);
		container = await make_the_response(container);
	}
	catch(error)
	{
		//
		//  1.  Create a message to send back
		//
		let message = {
			message: error.message || error
		};

		//
		//  2.  Create the response
		//
		let response = {
			statusCode: error.status || 500,
			headers: {

				//
				//	Required for CORS support to work
				//
				"Access-Control-Allow-Origin" : "*",

				//
				//	Required for cookies, authorization headers with HTTPS
				//
				"Access-Control-Allow-Credentials" : true
			},
			body: JSON.stringify(message, null, 4)
		};

		//
		//  ->  Tell lambda that we finished
		//
		return response;
	}

	//
	//	->	Return a positive response
	//
	return container.response;

};

//	 _____   _____    ____   __  __  _____   _____  ______   _____
//	|  __ \ |  __ \  / __ \ |  \/  ||_   _| / ____||  ____| / ____|
//	| |__) || |__) || |  | || \  / |  | |  | (___  | |__   | (___
//	|  ___/ |  _  / | |  | || |\/| |  | |   \___ \ |  __|   \___ \
//	| |     | | \ \ | |__| || |  | | _| |_  ____) || |____  ____) |
//	|_|     |_|  \_\ \____/ |_|  |_||_____||_____/ |______||_____/
//

//
//	Make sure the user entered all the data, and the data is valid
//
function request_validation(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Check if the data conforms
		//
		let result = validate(container.request, constraints);

		//
		//	2.	Check if Validate found some issues
		//
		if(result)
		{
			//
			//	1.	Set the status message to help understand what happened in
			//		programmatically way.
			//
			result.status = 400;

			//
			//	->	Stop and pass the error forward
			//
			return reject(result);
		}

		//
		//	->	Move to the next chain
		//
		return resolve(container);

	});
}

//
//	Make sure the user entered all the data, and the data is valid
//
function get_secrets(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Set what secrets do we need
		//
		let options = {
			SecretId: "reCaptcha_home"
		};

		//
		//	2.	Execute the query
		//
		secrets_manager.getSecretValue(options, function(error, data) {

		    //
		    //	1.	Check for a internal error
		    //
		    if(error)
		    {
		        return reject(error);
		    }

			//
			//	2.	Save the reCaptcha secret for other promises
			//
		    container.secrets = JSON.parse(data.SecretString);

		   	//
			//	->	Move to the next chain
			//
			return resolve(container);

		});

	});
}

//
//  Once we know that we have all the data we will validate
//
function check_re_captcha(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Create the object with the related data for the function
		//
		let data = {
			recaptcha: container.request.recaptcha,
			secret: container.secrets.SECRET
		};

		//
		//	2.	Prepare the request configuration
		//
		let params = {
			FunctionName: 'reCAPTCHA',
			Payload: JSON.stringify(data, null, 2),
		};

		//
		//	2.	Invoke the Lambda Function
		//
		lambda.invoke(params, function(error, data) {

			//
			//	1.	Check if there was an error in invoking the fnction
			//
			if(error)
			{
				return reject(error);
			}

			//
			//	2.	Convert the payload to JS
			//
			let response = JSON.parse(data.Payload);

			//
			//	3.	Check if there was an error
			//
			if(response)
			{
				//
				//	2.
				//
				if(response.errorMessage)
				{
					//
					//	1.	Create the error based on what the other function
					//		sent back
					//
					let error = new Error(response.errorMessage);

					//
					//	->	Stop here and surface the error
					//
					return reject(error);
				}
			}

			//
			//	4.	Check if the resposne is wrong. If it is we know it is
			//		a geenral error.
			//
			if(!response)
			{
				//
				//	1.	Create the error based on what the other function
				//		sent back
				//
				let error = new Error("reCatpcha Error");

				//
				//	->	Stop here and surface the error
				//
				return reject(error);
			}

			//
			//	->	Move to the next chain
			//
			return resolve(container);

		});

	});
}

//
//	Once we know the data is correct we can create the whole email
//
function create_the_email(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Preapre the email data used to construct the final email
		//
		container.email = {
			from	: process.env.FROM,
			to		: process.env.TO,
			subject	: "From contact page",
			reply_to: container.request.from,
			html	: container.request.html 	|| '',
			text	: container.request.text 	|| ''
		};

		//
		//	->	Move to the next chain
		//
		return resolve(container);

	});
}

//
//  Send the email to the offcie using SES
//
function send_the_email(container)
{
	return new Promise(function(resolve, reject) {

		//
		//	1.	Prepare the request configuration
		//
		let params = {
			FunctionName: 'Toolbox_Send_Email',
			Payload: JSON.stringify(container.email, null, 2),
		};

		//
		//	2.	Invoke the Lambda Function
		//
		lambda.invoke(params, function(error, data) {

			//
			//	1.	Check if there was an error in invoking the fnction
			//
			if(error)
			{
				return reject(error);
			}

			//
			//	2.	Convert the payload to JS
			//
			let response = JSON.parse(data.Payload);

			//
			//	3.	Check if there was an error
			//
			if(response.errorMessage)
			{
				//
				//	1.	Create the error based on what the other function
				//		sent back
				//
				let error = new Error(response.errorMessage);

				//
				//	->	Stop here and surface the error
				//
				return reject(error);
			}

			//
			//	->	Move to the next chain
			//
			return resolve(container);

		});

	});
}

//
//	AWS Lamdas responses are much more complicted and require more data to
//	produce a response that just works. Hend putting it all in one place.
//
function make_the_response(container)
{
	return new Promise(function(resolve, reject) {

		//
		//  1.  Create a positive message
		//
		container.response = {
			statusCode: 200,
			headers: {
				"Access-Control-Allow-Origin" : "*",		// Required for CORS support to work
				"Access-Control-Allow-Credentials" : true	// Required for cookies, authorization headers with HTTPS
			},
			body: JSON.stringify({
				message: "Sent"
			}, null, 4)

		};

		//
		//	->	Move to the next chain
		//
		return resolve(container);

	});
}


//  _    _   ______   _        _____    ______   _____     _____
// | |  | | |  ____| | |      |  __ \  |  ____| |  __ \   / ____|
// | |__| | | |__    | |      | |__) | | |__    | |__) | | (___
// |  __  | |  __|   | |      |  ___/  |  __|   |  _  /   \___ \
// | |  | | | |____  | |____  | |      | |____  | | \ \   ____) |
// |_|  |_| |______| |______| |_|      |______| |_|  \_\ |_____/
//

//
//	Constrains to check against
//
let constraints = {
	from: {
		presence: true,
		format: {
			pattern: /(?:"?([^"]*)"?\s)?(?:<?(.+@[^>]+)>?)/,
			message: "Doesn't look like a valid email"
		}
	},
	text: {
		presence: true
	},
	recaptcha: {
		presence: true
	}
};