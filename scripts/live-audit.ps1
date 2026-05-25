param(
  [string]$BaseUrl = "https://karimnagar-frames.onrender.com",
  [string]$OwnerId = $env:LIVE_AUDIT_OWNER_ID,
  [string]$OwnerPassword = $env:LIVE_AUDIT_OWNER_PASSWORD
)

$ErrorActionPreference = "Stop"
$results = New-Object System.Collections.Generic.List[object]

function Add-Result($Name, $Ok, $Detail = "") {
  $script:results.Add([pscustomobject]@{
    name = $Name
    ok = [bool]$Ok
    detail = [string]$Detail
  }) | Out-Null
}

function Request-Json($Method, $Path, $Body = $null, $Session = $null, [switch]$ExpectFail) {
  $params = @{
    Uri = $BaseUrl.TrimEnd("/") + $Path
    Method = $Method
    ContentType = "application/json"
    TimeoutSec = 60
  }
  if ($null -ne $Body) {
    $params.Body = ($Body | ConvertTo-Json -Depth 30)
  }
  if ($null -ne $Session) {
    $params.WebSession = $Session
  }
  try {
    return Invoke-RestMethod @params
  } catch {
    if ($ExpectFail) {
      return $_
    }
    if ($_.ErrorDetails.Message) {
      throw $_.ErrorDetails.Message
    }
    throw $_.Exception.Message
  }
}

function Response-Status($ErrorRecord) {
  if ($ErrorRecord.Exception -and $ErrorRecord.Exception.Response) {
    return $ErrorRecord.Exception.Response.StatusCode.value__
  }
  return 0
}

try {
  if (-not $OwnerId -or -not $OwnerPassword) {
    throw "LIVE_AUDIT_OWNER_ID and LIVE_AUDIT_OWNER_PASSWORD are required."
  }

  $health = Request-Json GET "/api/health"
  Add-Result "Health endpoint" ($health.ok -eq $true) $health.time

  $products = Request-Json GET "/api/products"
  Add-Result "Products API returns catalog" (@($products.products).Count -ge 5) (@($products.products).Count.ToString() + " products")
  $badProducts = @($products.products | Where-Object {
    -not $_.id -or -not $_.name -or ([double]$_.basePrice -le 0) -or -not $_.images -or -not $_.photoRequirements
  })
  Add-Result "Product data completeness" ($badProducts.Count -eq 0) (($badProducts | ForEach-Object { $_.id }) -join ",")

  $imageFailures = New-Object System.Collections.Generic.List[string]
  foreach ($product in $products.products) {
    $image = @($product.images)[0]
    if ($image -and $image.StartsWith("/")) {
      try {
        $imageResponse = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl.TrimEnd("/") + $image) -Method Get -TimeoutSec 30
        if ($imageResponse.StatusCode -ne 200) {
          $imageFailures.Add($product.id + ":" + $imageResponse.StatusCode) | Out-Null
        }
      } catch {
        $imageFailures.Add($product.id) | Out-Null
      }
    }
  }
  Add-Result "Product images reachable" ($imageFailures.Count -eq 0) ($imageFailures -join ",")

  $sitemap = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl.TrimEnd("/") + "/sitemap.xml") -TimeoutSec 30
  Add-Result "Sitemap includes product URLs" ($sitemap.Content.Contains("product.html?id=cup-photo-printing") -and $sitemap.Content.Contains("product.html?id=pillow-printing")) ("length=" + $sitemap.Content.Length)

  $guestCart = Request-Json GET "/api/cart" $null $null -ExpectFail
  Add-Result "Guest cart blocked" ((Response-Status $guestCart) -eq 401) ("status=" + (Response-Status $guestCart))
  $guestOrderBody = @{
    customer = @{ name = "Guest"; phone = "9999999999"; address = "Karimnagar" }
    items = @(@{ productId = "cup-photo-printing"; quantity = 1; options = @{} })
  }
  $guestOrder = Request-Json POST "/api/orders" $guestOrderBody $null -ExpectFail
  Add-Result "Guest order blocked" ((Response-Status $guestOrder) -eq 401) ("status=" + (Response-Status $guestOrder))

  $stamp = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
  $phone = "3" + ($stamp.ToString().Substring($stamp.ToString().Length - 9))
  $email = "kf-audit-" + $stamp + "@example.com"
  $password = "Customer@Test123"
  $customerSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $otp = Request-Json POST "/api/auth/request-otp" @{
    name = "Audit Customer"
    phone = $phone
    email = $email
    password = $password
  } $customerSession
  Add-Result "Customer OTP request works" ($otp.ok -eq $true -and $otp.challengeId -and $otp.demoOtp) ("channel=" + $otp.otpChannel + ", provider=" + $otp.otpProvider)
  $verify = Request-Json POST "/api/auth/verify-otp" @{ challengeId = $otp.challengeId; otp = $otp.demoOtp } $customerSession
  Add-Result "Customer OTP verify creates account" ($verify.ok -eq $true -and $verify.user.phone -eq $phone) ("user=" + $verify.user.id)
  $me = Request-Json GET "/api/auth/me" $null $customerSession
  Add-Result "Customer session active" ($me.user.phone -eq $phone) $me.user.role

  $pillowOptions = @{ "Pillow size" = "12x12 inches"; "Print side" = "Both sides" }
  $cartPut = Request-Json PUT "/api/cart" @{ items = @(@{ productId = "pillow-printing"; quantity = 1; options = $pillowOptions }) } $customerSession
  Add-Result "Customer cart save" (@($cartPut.cart.items).Count -eq 1) (@($cartPut.cart.items)[0].productId)
  $cartGet = Request-Json GET "/api/cart" $null $customerSession
  Add-Result "Customer cart persists on server" (@($cartGet.cart.items).Count -eq 1) (@($cartGet.cart.items)[0].name)
  $cartItem = @($cartGet.cart.items)[0]

  $tinyPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="
  $oneUploadOrder = @{
    customer = @{ name = "Audit Customer"; phone = $phone; email = $email; address = "Karimnagar audit address" }
    items = $cartGet.cart.items
    payment = @{ method = "Pay on Delivery" }
    uploads = @(@{ name = "front.png"; label = "Front Side Photo"; itemKey = $cartItem.cartKey; productId = "pillow-printing"; dataUrl = $tinyPng })
  }
  $oneUploadFail = Request-Json POST "/api/orders" $oneUploadOrder $customerSession -ExpectFail
  Add-Result "Multi-photo validation blocks incomplete pillow order" ((Response-Status $oneUploadFail) -eq 400) ("status=" + (Response-Status $oneUploadFail))

  $twoUploadOrder = @{
    customer = @{ name = "Audit Customer"; phone = $phone; email = $email; address = "Karimnagar audit address" }
    notes = "FULL LIVE AUDIT TEST ORDER - cancel"
    items = $cartGet.cart.items
    payment = @{ method = "Pay on Delivery" }
    uploads = @(
      @{ name = "front.png"; label = "Front Side Photo"; itemKey = $cartItem.cartKey; productId = "pillow-printing"; dataUrl = $tinyPng },
      @{ name = "back.png"; label = "Back Side Photo"; itemKey = $cartItem.cartKey; productId = "pillow-printing"; dataUrl = $tinyPng }
    )
  }
  $order = Request-Json POST "/api/orders" $twoUploadOrder $customerSession
  $orderId = $order.order.id
  Add-Result "Customer place order succeeds" ($order.ok -eq $true -and @($order.order.uploads).Count -eq 2) ($orderId + ", total=" + $order.order.total)
  $afterCart = Request-Json GET "/api/cart" $null $customerSession
  Add-Result "Cart clears after order" (@($afterCart.cart.items).Count -eq 0) ""
  $customerOrders = Request-Json GET "/api/orders" $null $customerSession
  Add-Result "Customer dashboard orders API shows order" (@($customerOrders.orders | Where-Object { $_.id -eq $orderId }).Count -eq 1) ("count=" + @($customerOrders.orders).Count)
  $uploadUrl = @($order.order.uploads)[0].url
  $uploadResponse = Invoke-WebRequest -UseBasicParsing -Uri ($BaseUrl.TrimEnd("/") + $uploadUrl) -TimeoutSec 30
  Add-Result "Uploaded order photo reachable" ($uploadResponse.StatusCode -eq 200) $uploadUrl
  Add-Result "WhatsApp owner link generated" ([string]$order.order.whatsappUrl -match "wa.me/9032428063") ""
  Add-Result "WhatsApp customer link generated" ([string]$order.order.customerWhatsappUrl -match "wa.me/91") ""

  $adminSession = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $adminLogin = Request-Json POST "/api/auth/login" @{ identifier = $OwnerId; password = $OwnerPassword } $adminSession
  Add-Result "Owner login works" ($adminLogin.user.role -eq "admin") $adminLogin.user.username
  $ownerOrders = Request-Json GET "/api/orders" $null $adminSession
  Add-Result "Owner orders API sees audit order" (@($ownerOrders.orders | Where-Object { $_.id -eq $orderId }).Count -eq 1) ("orders=" + @($ownerOrders.orders).Count)
  $payment = Request-Json PATCH ("/api/orders/" + $orderId + "/payment") @{ status = "Paid" } $adminSession
  Add-Result "Owner payment update works" ($payment.order.payment.status -eq "Paid") $payment.order.payment.status
  $status = Request-Json PATCH ("/api/orders/" + $orderId + "/status") @{ status = "Accepted" } $adminSession
  Add-Result "Owner status update works" ($status.order.status -eq "Accepted") $status.order.status
  $customers = Request-Json GET ("/api/customers?q=" + $phone) $null $adminSession
  Add-Result "Owner customer search by mobile works" (@($customers.customers | Where-Object { $_.phone -eq $phone }).Count -eq 1) ("customers=" + @($customers.customers).Count)

  $contact = Request-Json POST "/api/contact" @{ name = "Audit Contact"; phone = $phone; email = $email; message = "FULL LIVE AUDIT CONTACT TEST" }
  Add-Result "Contact form API works" ($contact.ok -eq $true -and $contact.contact.id) $contact.contact.id
  $contacts = Request-Json GET "/api/contact" $null $adminSession
  Add-Result "Owner messages API works" (@($contacts.contacts | Where-Object { $_.id -eq $contact.contact.id }).Count -eq 1) ("contacts=" + @($contacts.contacts).Count)

  $newProduct = Request-Json POST "/api/admin/products" @{
    name = ("Audit Hidden Product " + $stamp)
    category = "frames"
    basePrice = 321
    stockStatus = "Available"
    summary = "Audit product"
    description = "Audit product"
    sizes = @("A4")
    colors = @("Black")
    photoMin = 1
    photoMax = 1
    photoLabels = @("Audit Photo")
  } $adminSession
  Add-Result "Owner product create works" ($newProduct.product.id) $newProduct.product.id
  $productId = $newProduct.product.id
  $publicNew = Request-Json GET ("/api/products/" + $productId)
  Add-Result "New product appears publicly" ($publicNew.product.id -eq $productId) $publicNew.product.name
  $updatedProduct = $newProduct.product
  $updatedProduct.name = $updatedProduct.name + " Updated"
  $updatedProduct.basePrice = 333
  $productUpdate = Request-Json PUT ("/api/admin/products/" + $productId) $updatedProduct $adminSession
  Add-Result "Owner product update works" ($productUpdate.product.basePrice -eq 333) $productUpdate.product.name
  $productDelete = Request-Json DELETE ("/api/admin/products/" + $productId) $null $adminSession
  Add-Result "Owner product delete/disable works" ($productDelete.ok -eq $true) ""
  $publicDeleted = Request-Json GET ("/api/products/" + $productId) $null $null -ExpectFail
  Add-Result "Deleted product hidden publicly" ((Response-Status $publicDeleted) -eq 404) ("status=" + (Response-Status $publicDeleted))

  Request-Json PATCH ("/api/orders/" + $orderId + "/status") @{ status = "Cancelled" } $adminSession | Out-Null
  Add-Result "Audit order cancelled after test" $true $orderId
} catch {
  Add-Result "AUDIT SCRIPT FAILURE" $false ($_ | Out-String)
}

[pscustomobject]@{
  passed = @($results | Where-Object { $_.ok }).Count
  failed = @($results | Where-Object { -not $_.ok }).Count
  results = $results
} | ConvertTo-Json -Depth 8
