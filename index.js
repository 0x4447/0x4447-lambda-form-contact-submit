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
exports.handler = (event) => {

	return new Promise(function(resolve, reject) {

		//
		//	1.	Create a container that will be passed around the chain
		//
		let container = {
			request: event,
			email: {},
			response: {}
		};

		//
		//	->	Start the chain.
		//
		request_validation(container)
			.then(function(container) {

				return get_secrets(container);

			}).then(function(container) {

				return check_re_captcha(container);

			}).then(function(container) {

				return send_the_email(container);

			}).then(function(container) {

				return resolve(container.response);

			}).catch(function(error) {

				return reject(error);

			});

	});

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

		console.info('request_validation');

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

		console.info('get_secrets');

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

		console.info('check_re_captcha');

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
			FunctionName: process.env.LAMBDA_RECAPTCHA,
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
//  Send the email to the offcie using SES
//
function send_the_email(container)
{
	return new Promise(function(resolve, reject) {

		console.info('send_the_email');

		//
		//	1.	Preapre the email data used to construct the final email
		//
		let data = {
			from	: process.env.FROM,
			to		: process.env.TO,
			subject	: "From contact page",
			reply_to: container.request.from,
			html	: container.request.html 	|| '',
			text	: container.request.text 	|| ''
		};

		//
		//	2.	Prepare the request configuration
		//
		let params = {
			FunctionName: process.env.LAMBDA_SEND_EMAIL,
			Payload: JSON.stringify(data, null, 2),
		};

		//
		//	3.	Invoke the Lambda Function
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