/*
  Copyright (c) 2008 - 2016 MongoDB, Inc. <http://mongodb.com>

  Licensed under the Apache License, Version 2.0 (the "License");
  you may not use this file except in compliance with the License.
  You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

  Unless required by applicable law or agreed to in writing, software
  distributed under the License is distributed on an "AS IS" BASIS,
  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  See the License for the specific language governing permissions and
  limitations under the License.
*/


let express = require('express'),
    bodyParser = require('body-parser'),
    nunjucks = require('nunjucks'),
    MongoClient = require('mongodb').MongoClient,
    assert = require('assert'),
    ItemDAO = require('./items').ItemDAO,
    CartDAO = require('./cart').CartDAO;


// Set up express
app = express();
app.set('view engine', 'html');
app.set('views', __dirname + '/views');
app.use('/static', express.static(__dirname + '/static'));
app.use(bodyParser.urlencoded({ extended: true }));


/*
 Configure nunjucks to work with express
 Not using consolidate because I'm waiting on better support for template inheritance with
 nunjucks via consolidate. See: https://github.com/tj/consolidate.js/pull/224
*/
let env = nunjucks.configure('views', {
    autoescape: true,
    express: app
});

let nunjucksDate = require('nunjucks-date');
nunjucksDate.setDefaultFormat('MMMM Do YYYY, h:mm:ss a');
env.addFilter("date", nunjucksDate);

const ITEMS_PER_PAGE = 5;

// Hardcoded USERID for use with the shopping cart portion
const USERID = "558098a65133816958968d88";

MongoClient.connect('mongodb://localhost:27017/mongomart', (err, db) => {
    "use strict";

    assert.equal(null, err);
    console.log("Successfully connected to MongoDB.");

    let items = new ItemDAO(db);
    let cart = new CartDAO(db);

    let router = express.Router();

    // Homepage
    router.get("/", (req, res) => {
        "use strict";

        var page = req.query.page ? parseInt(req.query.page) : 0;
        var category = req.query.category ? req.query.category : "All";

        items.getCategories(function(categories) {

            items.getItems(category, page, ITEMS_PER_PAGE, function(pageItems) {

                items.getNumItems(category, function(itemCount) {

                    var numPages = 0;
                    if (itemCount > ITEMS_PER_PAGE) {
                        numPages = Math.ceil(itemCount / ITEMS_PER_PAGE);
                    }

                    res.render('home', { category_param: category,
                                         categories: categories,
                                         useRangeBasedPagination: false,
                                         itemCount: itemCount,
                                         pages: numPages,
                                         page: page,
                                         items: pageItems });

                });
            });
        });
    });


    router.get("/search", (req, res) => {
        "use strict";

        var page = req.query.page ? parseInt(req.query.page) : 0;
        var query = req.query.query ? req.query.query : "";

        items.searchItems(query, page, ITEMS_PER_PAGE, function(searchItems) {

            items.getNumSearchItems(query, function(itemCount) {

                var numPages = 0;

                if (itemCount > ITEMS_PER_PAGE) {
                    numPages = Math.ceil(itemCount / ITEMS_PER_PAGE);
                }

                res.render('search', { queryString: query,
                                       itemCount: itemCount,
                                       pages: numPages,
                                       page: page,
                                       items: searchItems });

            });
        });
    });


    router.get("/item/:itemId", (req, res) => {
        "use strict";

        var itemId = parseInt(req.params.itemId);

        items.getItem(itemId, function(item) {

            if (item == null) {
                res.status(404).send("Item not found.");
                return;
            }

            var stars = 0;
            var numReviews = 0;
            var reviews = [];

            if ("reviews" in item) {
                numReviews = item.reviews.length;

                for (var i=0; i<numReviews; i++) {
                    var review = item.reviews[i];
                    stars += review.stars;
                }

                if (numReviews > 0) {
                    stars = stars / numReviews;
                    reviews = item.reviews;
                }
            }

            items.getRelatedItems((relatedItems) => {

                res.render("item",
                           {
                               userId: USERID,
                               item: item,
                               stars: stars,
                               reviews: reviews,
                               numReviews: numReviews,
                               relatedItems: relatedItems
                           });
            });
        });
    });


    router.post("/item/:itemId/reviews", (req, res) => {
        "use strict";

        var itemId = parseInt(req.params.itemId);
        var review = req.body.review;
        var name = req.body.name;
        var stars = parseInt(req.body.stars);

        items.addReview(itemId, review, name, stars, function(itemDoc) {
            res.redirect("/item/" + itemId);
        });
    });

    /*
     *
     * Since we are not maintaining user sessions in this application, any interactions with
     * the cart will be based on a single cart associated with the the USERID constant we have
     * defined above.
     *
     */

    router.get("/cart", (req, res) => {
        res.redirect("/user/" + USERID + "/cart");
    });


    router.get("/user/:userId/cart", (req, res) => {
        "use strict";

        var userId = req.params.userId;
        cart.getCart(userId, function(userCart) {
            let total = cartTotal(userCart);
            res.render("cart",
                       {
                           userId: userId,
                           updated: false,
                           cart: userCart,
                           total: total
                       });
        });
    });


    router.post("/user/:userId/cart/items/:itemId", (req, res) => {
        "use strict";

        let userId = req.params.userId;
        let itemId = parseInt(req.params.itemId);

        let renderCart = (userCart) => {
            let total = cartTotal(userCart);
            res.render("cart",
                       {
                           userId: userId,
                           updated: true,
                           cart: userCart,
                           total: total
                       });
        };

        cart.itemInCart(userId, itemId, (item) => {
            if (item == null) {                                       // add item
                items.getItem(itemId, (item) => {
                    item.quantity = 1;
                    cart.addItem(userId, item, (userCart) => {
                        renderCart(userCart);
                    });

                });
            } else {                                                  // increase quantity
                cart.updateQuantity(userId, itemId, item.quantity+1, (userCart) =>{
                    renderCart(userCart);
                });
            }
        });
    });


    router.post("/user/:userId/cart/items/:itemId/quantity", (req, res) => {
        "use strict";

        let userId = req.params.userId;
        let itemId = parseInt(req.params.itemId);
        let quantity = parseInt(req.body.quantity);

        cart.updateQuantity(userId, itemId, quantity, (userCart) => {
            let total = cartTotal(userCart);
            res.render("cart",
                       {
                           userId: userId,
                           updated: true,
                           cart: userCart,
                           total: total
                       });
        });
    });


    function cartTotal(userCart) {
        "use strict";
        return userCart.items.map( i => i.price * i.quantity).reduce((sum, cost) => sum + cost);
    };


    // Use the router routes in our application
    app.use('/', router);

    // Start the server listening
    let server = app.listen(3000, () => {
        let port = server.address().port;
        console.log('Mongomart server listening on port %s.', port);
    });

});
