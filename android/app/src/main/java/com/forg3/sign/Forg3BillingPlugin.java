package com.forg3.sign;

import android.content.Intent;
import android.net.Uri;
import com.android.billingclient.api.AcknowledgePurchaseParams;
import com.android.billingclient.api.BillingClient;
import com.android.billingclient.api.BillingClientStateListener;
import com.android.billingclient.api.BillingFlowParams;
import com.android.billingclient.api.BillingResult;
import com.android.billingclient.api.PendingPurchasesParams;
import com.android.billingclient.api.ProductDetails;
import com.android.billingclient.api.Purchase;
import com.android.billingclient.api.PurchasesUpdatedListener;
import com.android.billingclient.api.QueryProductDetailsParams;
import com.android.billingclient.api.QueryPurchasesParams;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "Forg3Billing")
public class Forg3BillingPlugin extends Plugin implements PurchasesUpdatedListener {
    private BillingClient billingClient;
    private PluginCall pendingPurchaseCall;
    private String pendingProductId;

    @Override
    public void load() {
        billingClient = BillingClient.newBuilder(getContext())
            .setListener(this)
            .enablePendingPurchases(
                PendingPurchasesParams.newBuilder()
                    .enableOneTimeProducts()
                    .build()
            )
            .build();
    }

    @PluginMethod
    public void purchase(PluginCall call) {
        String productId = call.getString("productId");
        if (productId == null || productId.trim().isEmpty()) {
            call.reject("productId is required.");
            return;
        }

        if (pendingPurchaseCall != null) {
            call.reject("A purchase is already in progress.");
            return;
        }

        ensureConnected(call, () -> queryAndLaunchPurchase(call, productId));
    }

    @PluginMethod
    public void restorePurchases(PluginCall call) {
        ensureConnected(call, () -> billingClient.queryPurchasesAsync(
            QueryPurchasesParams.newBuilder()
                .setProductType(BillingClient.ProductType.SUBS)
                .build(),
            (billingResult, purchases) -> {
                if (!isOk(billingResult)) {
                    call.reject(billingError("Restore failed", billingResult));
                    return;
                }

                JSArray purchaseArray = new JSArray();
                for (Purchase purchase : purchases) {
                    if (purchase.getPurchaseState() == Purchase.PurchaseState.PURCHASED) {
                        purchaseArray.put(purchaseToJsObject(purchase));
                    }
                }

                JSObject result = new JSObject();
                result.put("purchases", purchaseArray);
                call.resolve(result);
            }
        ));
    }

    @PluginMethod
    public void manageSubscriptions(PluginCall call) {
        String productId = call.getString("productId", "");
        Uri.Builder builder = Uri.parse("https://play.google.com/store/account/subscriptions").buildUpon()
            .appendQueryParameter("package", getContext().getPackageName());

        if (!productId.isEmpty()) {
            builder.appendQueryParameter("sku", productId);
        }

        Intent intent = new Intent(Intent.ACTION_VIEW, builder.build());
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);

        JSObject result = new JSObject();
        result.put("opened", true);
        call.resolve(result);
    }

    @Override
    public void onPurchasesUpdated(BillingResult billingResult, List<Purchase> purchases) {
        PluginCall call = pendingPurchaseCall;
        pendingPurchaseCall = null;

        if (call == null) {
            return;
        }

        if (billingResult.getResponseCode() == BillingClient.BillingResponseCode.USER_CANCELED) {
            call.reject("Purchase canceled.");
            return;
        }

        if (!isOk(billingResult)) {
            call.reject(billingError("Purchase failed", billingResult));
            return;
        }

        Purchase selectedPurchase = findPurchaseForProduct(purchases, pendingProductId);
        pendingProductId = null;

        if (selectedPurchase == null) {
            call.reject("Purchase did not return the selected product.");
            return;
        }

        if (selectedPurchase.getPurchaseState() != Purchase.PurchaseState.PURCHASED) {
            call.reject("Purchase is pending approval.");
            return;
        }

        acknowledgeIfNeeded(selectedPurchase);
        call.resolve(purchaseToJsObject(selectedPurchase));
    }

    private void queryAndLaunchPurchase(PluginCall call, String productId) {
        List<QueryProductDetailsParams.Product> products = new ArrayList<>();
        products.add(
            QueryProductDetailsParams.Product.newBuilder()
                .setProductId(productId)
                .setProductType(BillingClient.ProductType.SUBS)
                .build()
        );

        QueryProductDetailsParams params = QueryProductDetailsParams.newBuilder()
            .setProductList(products)
            .build();

        billingClient.queryProductDetailsAsync(params, (billingResult, queryResult) -> {
            if (!isOk(billingResult)) {
                call.reject(billingError("Product lookup failed", billingResult));
                return;
            }

            List<ProductDetails> details = queryResult.getProductDetailsList();
            if (details.isEmpty()) {
                call.reject("Store product is not configured or not available on this Play account.");
                return;
            }

            ProductDetails productDetails = details.get(0);
            List<ProductDetails.SubscriptionOfferDetails> offers = productDetails.getSubscriptionOfferDetails();
            if (offers == null || offers.isEmpty()) {
                call.reject("Subscription product has no active base plan or offer.");
                return;
            }

            BillingFlowParams.ProductDetailsParams productDetailsParams =
                BillingFlowParams.ProductDetailsParams.newBuilder()
                    .setProductDetails(productDetails)
                    .setOfferToken(offers.get(0).getOfferToken())
                    .build();

            BillingFlowParams flowParams = BillingFlowParams.newBuilder()
                .setProductDetailsParamsList(java.util.Collections.singletonList(productDetailsParams))
                .build();

            pendingPurchaseCall = call;
            pendingProductId = productId;
            BillingResult launchResult = billingClient.launchBillingFlow(getActivity(), flowParams);
            if (!isOk(launchResult)) {
                pendingPurchaseCall = null;
                pendingProductId = null;
                call.reject(billingError("Purchase could not start", launchResult));
            }
        });
    }

    private void ensureConnected(PluginCall call, Runnable onConnected) {
        if (billingClient != null && billingClient.isReady()) {
            onConnected.run();
            return;
        }

        billingClient.startConnection(new BillingClientStateListener() {
            @Override
            public void onBillingSetupFinished(BillingResult billingResult) {
                if (isOk(billingResult)) {
                    onConnected.run();
                } else {
                    call.reject(billingError("Play Billing is not ready", billingResult));
                }
            }

            @Override
            public void onBillingServiceDisconnected() {
                // The next purchase or restore attempt reconnects.
            }
        });
    }

    private void acknowledgeIfNeeded(Purchase purchase) {
        if (purchase.isAcknowledged()) {
            return;
        }

        AcknowledgePurchaseParams params = AcknowledgePurchaseParams.newBuilder()
            .setPurchaseToken(purchase.getPurchaseToken())
            .build();
        billingClient.acknowledgePurchase(params, billingResult -> {});
    }

    private Purchase findPurchaseForProduct(List<Purchase> purchases, String productId) {
        if (purchases == null) {
            return null;
        }

        for (Purchase purchase : purchases) {
            if (purchase.getProducts().contains(productId)) {
                return purchase;
            }
        }

        return purchases.isEmpty() ? null : purchases.get(0);
    }

    private JSObject purchaseToJsObject(Purchase purchase) {
        JSObject result = new JSObject();
        String productId = purchase.getProducts().isEmpty() ? "" : purchase.getProducts().get(0);
        result.put("providerReceipt", purchase.getPurchaseToken());
        result.put("purchaseToken", purchase.getPurchaseToken());
        result.put("productId", productId);
        result.put("transactionId", purchase.getOrderId());
        return result;
    }

    private boolean isOk(BillingResult result) {
        return result.getResponseCode() == BillingClient.BillingResponseCode.OK;
    }

    private String billingError(String prefix, BillingResult result) {
        String debugMessage = result.getDebugMessage();
        return debugMessage == null || debugMessage.isEmpty()
            ? prefix + "."
            : prefix + ": " + debugMessage;
    }
}
